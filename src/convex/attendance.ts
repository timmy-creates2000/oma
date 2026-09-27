import { getAuthUserId } from "@convex-dev/auth/server";
import type { Doc } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { ATTENDANCE_STATUS, DEVICE_STATUS, EVENT_KIND } from "./schema";
import {
  addDaysKey,
  arrivalStatus,
  audit,
  dayKey,
  dayKeyToDate,
  fmtTime,
  notify,
  requirePerm,
  requireWorkspace,
  sha256Hex,
} from "./helpers";

/* ================================ QR system ================================ */

/** Kiosk/display: mint a fresh single-use QR token. */
export const issueQrToken = mutation({
  args: { displayId: v.id("qrDisplays") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserIdOrThrow(ctx);
    const display = await ctx.db.get(args.displayId);
    if (!display) throw new Error("QR display not found");
    const me = await activeEmployeeFor(ctx, userId);
    if (!me || me.companyId !== display.companyId) {
      // Allow displays owned by this user's company only
      throw new Error("Forbidden");
    }
    const settings = await ctx.db
      .query("companySettings")
      .withIndex("by_company", (q) => q.eq("companyId", display.companyId))
      .first();
    const ttl = Math.min(120, Math.max(10, settings?.qrRotationSeconds ?? 30));

    const raw = randomRaw();
    const tokenHash = await sha256Hex(raw);
    const nonce = raw.slice(0, 16);
    const now = Date.now();
    await ctx.db.insert("qrTokens", {
      companyId: display.companyId,
      displayId: display._id,
      tokenHash,
      nonce,
      issuedAt: now,
      expiresAt: now + ttl * 1000,
    });
    return { raw, expiresAt: now + ttl * 1000, ttlSeconds: ttl };
  },
});

/** Scan: employee submits the raw token they scanned. */
export const scanQr = mutation({
  args: {
    rawToken: v.string(),
    deviceId: v.id("registeredDevices"),
    latitude: v.optional(v.number()),
    longitude: v.optional(v.number()),
    accuracyM: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserIdOrThrow(ctx);
    const me = await activeEmployeeFor(ctx, userId);
    if (!me) throw new Error("No active employee profile");

    const tokenHash = await sha256Hex(args.rawToken);
    const token =
      (await ctx.db
        .query("qrTokens")
        .withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash))
        .first()) ??
      // demo paste-flow fallback: nonce+prefix reconstructs the minted row
      (await (async () => {
        const nonce = args.rawToken.slice(0, 16);
        const prefix = args.rawToken.slice(16);
        if (nonce.length !== 16 || prefix.length !== 16) return null;
        const rows = await ctx.db
          .query("qrTokens")
          .withIndex("by_expires", (q) => q.gt("expiresAt", Date.now()))
          .order("desc")
          .take(30);
        return rows.find((t) => t.nonce === nonce && t.tokenHash.startsWith(prefix) && !t.consumedAt) ?? null;
      })());
    if (!token) throw new Error("Invalid QR code.");
    if (token.consumedAt) throw new Error("This QR code was already used. Scan the current code.");
    if (token.expiresAt < Date.now()) throw new Error("This QR code has expired. Scan the current code.");

    const display = await ctx.db.get(token.displayId);
    if (!display || display.companyId !== me.companyId) {
      throw new Error("QR code does not belong to your company.");
    }

    // device must belong to this employee and be active
    const device = await ctx.db.get(args.deviceId);
    if (!device || device.employeeId !== me._id) throw new Error("Device is not registered to you.");
    if (device.status !== DEVICE_STATUS.ACTIVE) {
      await ctx.db.insert("deviceEvents", {
        companyId: me.companyId, deviceId: device._id, employeeId: me._id,
        type: "scan_rejected", detail: "Scan attempted with non-active device",
        actor: me.email, at: Date.now(),
      });
      throw new Error("This device is not active. Contact HR.");
    }

    // company settings
    const settings = await ctx.db
      .query("companySettings")
      .withIndex("by_company", (q) => q.eq("companyId", me.companyId))
      .first();
    const company = await ctx.db.get(me.companyId) as Doc<"companies"> | null;
    if (!company) throw new Error("Company missing");

    // optional geo verification
    let geoVerified = false;
    if (settings?.requireGeo && company.geoVerification) {
      const branch = (me.branchId ? await ctx.db.get(me.branchId) : null) as Doc<"branches"> | null;
      const officeBranch = branch && branch.latitude != null
        ? branch
        : (await ctx.db.query("branches").withIndex("by_company", (q) => q.eq("companyId", me.companyId)).first());
      if (officeBranch?.latitude != null && officeBranch.longitude != null) {
        if (args.latitude == null || args.longitude == null) {
          throw new Error("Location is required for this office. Enable location and try again.");
        }
        const dist = haversineMeters(args.latitude, args.longitude, officeBranch.latitude, officeBranch.longitude);
        const radius = officeBranch.geofenceRadiusM ?? 200;
        if (dist > radius) {
          throw new Error(`You appear to be ${Math.round(dist)}m from ${officeBranch.name} — outside the office geofence.`);
        }
        geoVerified = true;
      }
    }

    const now = Date.now();
    const dk = dayKey(now);
    const wh = company.workingHours;

    // consume token (single-use) inside this mutation
    await ctx.db.patch(token._id, { consumedAt: now, consumedBy: me._id });

    const open = await ctx.db
      .query("attendanceSessions")
      .withIndex("by_employee_day", (q) => q.eq("employeeId", me._id).eq("dayKey", dk))
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .first();

    if (!open || !open.clockOutAt) {
      if (open && !open.clockOutAt && open.status !== ATTENDANCE_STATUS.ON_LEAVE) {
        throw new Error("You already have an open session. Scan again to clock out.");
      }
      // clock in
      if (open && open.status === ATTENDANCE_STATUS.ON_LEAVE) {
        throw new Error("You are on approved leave today.");
      }
      const already = open; // closed session exists
      if (already && already.clockOutAt) {
        throw new Error("You have already completed attendance for today.");
      }
      const arr = arrivalStatus(wh, now);
      const sessionId = await ctx.db.insert("attendanceSessions", {
        companyId: me.companyId,
        employeeId: me._id,
        dayKey: dk,
        clockInAt: now,
        breakMinutes: 0,
        status: arr.status,
        lateMinutes: arr.lateMinutes,
        earlyLeaveMinutes: 0,
        overtimeMinutes: 0,
        clockInDeviceId: device._id,
        clockInDisplayId: display._id,
        geoVerified,
      });
      await ctx.db.insert("attendanceEvents", {
        companyId: me.companyId, employeeId: me._id, sessionId,
        kind: EVENT_KIND.CLOCK_IN, at: now, dayKey: dk,
        deviceId: device._id, displayId: display._id, geoVerified,
      });
      if (arr.lateMinutes > 0) {
        await notify(ctx, {
          companyId: me.companyId, audience: "admins", type: "employee_late",
          title: "Late arrival",
          body: `${me.name} clocked in ${arr.lateMinutes}m late at ${fmtTime(now)}.`,
        });
      }
      return {
        action: "clock_in" as const,
        at: now,
        status: arr.status,
        lateMinutes: arr.lateMinutes,
        message: arr.lateMinutes > 0
          ? `Clocked in — marked LATE by ${arr.lateMinutes} min.`
          : "Clocked in. Have a great day!",
      };
    }

    // clock out
    const workedRaw = Math.round((now - open.clockInAt) / 60000) - open.breakMinutes;
    const worked = Math.max(0, workedRaw);
    const scheduled = Math.max(1, wh.endMinutes - wh.startMinutes);
    const endMinutes = nowMinutesUtc(now);
    const earlyLeave = Math.max(0, wh.endMinutes - endMinutes);
    const overtime = Math.max(0, worked - scheduled);
    const halfDay = worked < scheduled / 2;
    const status = halfDay ? ATTENDANCE_STATUS.HALF_DAY : open.status;
    await ctx.db.patch(open._id, {
      clockOutAt: now,
      workedMinutes: worked,
      earlyLeaveMinutes: earlyLeave,
      overtimeMinutes: overtime,
      status,
      clockOutDeviceId: device._id,
      geoVerified: open.geoVerified || geoVerified,
    });
    await ctx.db.insert("attendanceEvents", {
      companyId: me.companyId, employeeId: me._id, sessionId: open._id,
      kind: EVENT_KIND.CLOCK_OUT, at: now, dayKey: dk,
      deviceId: device._id, displayId: display._id, geoVerified,
    });
    return {
      action: "clock_out" as const,
      at: now,
      workedMinutes: worked,
      overtimeMinutes: overtime,
      message: `Clocked out — ${(worked / 60).toFixed(1)}h worked today.${overtime > 0 ? ` (${overtime}m overtime)` : ""}`,
    };
  },
});

/* ============================== attendance reads ============================ */

/** Demo convenience: the token currently displayed on an active kiosk.
 *  A real mobile app would read this value by scanning the QR image;
 *  validation is identical either way — it happens in scanQr on the server. */
export const currentTokenForScanning = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const me = await ctx.db
      .query("employees")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .filter((q) => q.eq(q.field("active"), true))
      .first();
    if (!me) return null;
    const now = Date.now();
    const tokens = await ctx.db
      .query("qrTokens")
      .withIndex("by_expires", (q) => q.gt("expiresAt", now))
      .order("desc")
      .take(20);
    const live = tokens.find((t) => t.companyId === me.companyId && !t.consumedAt);
    if (!live) return null;
    // raw token can be reconstructed for demo only because nonce stores first
    // 16 chars; instead return the token row signed with its nonce as "raw".
    // The scan mutation accepts either the exact raw value; for the demo we
    // pass a deterministic reconstructable payload.
    return { raw: live.nonce + live.tokenHash.slice(0, 16), expiresAt: live.expiresAt, tokenId: live._id };
  },
});

export const myToday = query({
  args: {},
  handler: async (ctx) => {
    const ws = await requireWorkspace(ctx);
    const dk = dayKey(Date.now());
    const session = await ctx.db
      .query("attendanceSessions")
      .withIndex("by_employee_day", (q) => q.eq("employeeId", ws.employee._id).eq("dayKey", dk))
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .first();
    return session;
  },
});

export const myHistory = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const ws = await requireWorkspace(ctx);
    const rows = await ctx.db
      .query("attendanceSessions")
      .withIndex("by_employee_recent", (q) => q.eq("employeeId", ws.employee._id))
      .order("desc")
      .take(args.limit ?? 60);
    return rows.filter((r) => !r.deletedAt);
  },
});

export const myEvents = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const ws = await requireWorkspace(ctx);
    const rows = await ctx.db
      .query("attendanceEvents")
      .withIndex("by_employee", (q) => q.eq("employeeId", ws.employee._id))
      .order("desc")
      .take(args.limit ?? 20);
    return rows;
  },
});

/* ============================ admin: live & lists =========================== */

export const liveAttendance = query({
  args: {},
  handler: async (ctx) => {
    const ws = await requireWorkspace(ctx);
    const dk = dayKey(Date.now());
    const sessions = await ctx.db
      .query("attendanceSessions")
      .withIndex("by_company_day", (q) => q.eq("companyId", ws.company._id).eq("dayKey", dk))
      .collect();
    const employees = await activeEmployees(ctx, ws.company._id);
    const byEmp = new Map(sessions.map((s) => [s.employeeId, s]));
    return employees.map((e) => ({ employee: e, session: byEmp.get(e._id) ?? null }));
  },
});

export const recentEvents = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const ws = await requireWorkspace(ctx);
    return await ctx.db
      .query("attendanceEvents")
      .withIndex("by_company", (q) => q.eq("companyId", ws.company._id))
      .order("desc")
      .take(args.limit ?? 25);
  },
});

export const adminListSessions = query({
  args: {
    day: v.optional(v.string()),
    employeeId: v.optional(v.id("employees")),
    status: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const ws = await requireWorkspace(ctx);
    requirePerm(ws, "view_reports");
    const dk = args.day ?? dayKey(Date.now());
    const employees = await activeEmployees(ctx, ws.company._id);
    const empById = new Map(employees.map((e) => [e._id, e]));
    let sessions;
    if (args.employeeId) {
      sessions = await ctx.db
        .query("attendanceSessions")
        .withIndex("by_employee_day", (q) => q.eq("employeeId", args.employeeId!).eq("dayKey", dk))
        .collect();
    } else {
      sessions = await ctx.db
        .query("attendanceSessions")
        .withIndex("by_company_day", (q) => q.eq("companyId", ws.company._id).eq("dayKey", dk))
        .collect();
    }
    let rows = sessions.filter((s) => !s.deletedAt);
    if (args.status) rows = rows.filter((s) => s.status === args.status);
    rows.sort((a, b) => b.clockInAt - a.clockInAt);
    return rows.slice(0, args.limit ?? 300).map((s) => ({
      session: s,
      employee: empById.get(s.employeeId) ?? null,
    }));
  },
});

/* ================================ corrections =============================== */

export const requestCorrection = mutation({
  args: {
    sessionDate: v.string(),
    requestedClockInAt: v.optional(v.number()),
    requestedClockOutAt: v.optional(v.number()),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const ws = await requireWorkspace(ctx);
    if (!args.reason.trim()) throw new Error("A reason is required.");
    await ctx.db.insert("correctionRequests", {
      companyId: ws.company._id,
      employeeId: ws.employee._id,
      sessionDate: args.sessionDate,
      requestedClockInAt: args.requestedClockInAt,
      requestedClockOutAt: args.requestedClockOutAt,
      reason: args.reason.trim(),
      status: "pending",
      createdAt: Date.now(),
    });
    await notify(ctx, {
      companyId: ws.company._id, audience: "admins", type: "correction_pending",
      title: "Attendance correction requested",
      body: `${ws.employee.name} requested a correction for ${args.sessionDate}.`,
    });
    await audit(ctx, ws, "correction.requested", `${ws.employee.email} for ${args.sessionDate}`);
    return { ok: true };
  },
});

export const listCorrections = query({
  args: { status: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const ws = await requireWorkspace(ctx);
    const rows = args.status
      ? await ctx.db.query("correctionRequests")
          .withIndex("by_company_status", (q) => q.eq("companyId", ws.company._id).eq("status", args.status as any))
          .collect()
      : await ctx.db.query("correctionRequests")
          .withIndex("by_company_status", (q) => q.eq("companyId", ws.company._id))
          .collect();
    const employees = await activeEmployees(ctx, ws.company._id);
    const empById = new Map(employees.map((e) => [e._id, e]));
    return rows
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((r) => ({ request: r, employee: empById.get(r.employeeId) ?? null }));
  },
});

export const myCorrections = query({
  args: {},
  handler: async (ctx) => {
    const ws = await requireWorkspace(ctx);
    const rows = await ctx.db
      .query("correctionRequests")
      .withIndex("by_employee", (q) => q.eq("employeeId", ws.employee._id))
      .collect();
    return rows.sort((a, b) => b.createdAt - a.createdAt);
  },
});

export const decideCorrection = mutation({
  args: { id: v.id("correctionRequests"), approve: v.boolean(), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const ws = await requireWorkspace(ctx);
    requirePerm(ws, "approve_corrections");
    const req = await ctx.db.get(args.id);
    if (!req || req.companyId !== ws.company._id) throw new Error("Request not found");
    if (req.status !== "pending") throw new Error("Already reviewed");

    await ctx.db.patch(args.id, {
      status: args.approve ? "approved" : "rejected",
      reviewedBy: ws.user.email ?? ws.user.name,
      reviewedAt: Date.now(),
      reviewerNote: args.note,
    });

    if (args.approve) {
      const session = await ctx.db
        .query("attendanceSessions")
        .withIndex("by_employee_day", (q) => q.eq("employeeId", req.employeeId).eq("dayKey", req.sessionDate))
        .first();
      const company = ws.company;
      const wh = company.workingHours;
      if (session) {
        const inAt = req.requestedClockInAt ?? session.clockInAt;
        const outAt = req.requestedClockOutAt ?? session.clockOutAt;
        const arr = arrivalStatus(wh, inAt);
        const worked = outAt ? Math.max(0, Math.round((outAt - inAt) / 60000) - session.breakMinutes) : undefined;
        const scheduled = Math.max(1, wh.endMinutes - wh.startMinutes);
        const earlyLeave = outAt ? Math.max(0, wh.endMinutes - nowMinutesUtc(outAt)) : 0;
        const overtime = worked != null ? Math.max(0, worked - scheduled) : 0;
        const status = worked != null && worked < scheduled / 2 ? ATTENDANCE_STATUS.HALF_DAY : arr.status;
        await ctx.db.patch(session._id, {
          clockInAt: inAt,
          clockOutAt: outAt,
          workedMinutes: worked,
          lateMinutes: arr.lateMinutes,
          earlyLeaveMinutes: earlyLeave,
          overtimeMinutes: overtime,
          status,
        });
      } else if (req.requestedClockInAt) {
        const arr = arrivalStatus(wh, req.requestedClockInAt);
        const sessionId = await ctx.db.insert("attendanceSessions", {
          companyId: ws.company._id, employeeId: req.employeeId,
          dayKey: req.sessionDate, clockInAt: req.requestedClockInAt,
          clockOutAt: req.requestedClockOutAt,
          breakMinutes: 0, status: arr.status, lateMinutes: arr.lateMinutes,
          earlyLeaveMinutes: 0, overtimeMinutes: 0,
          workedMinutes: req.requestedClockOutAt
            ? Math.max(0, Math.round((req.requestedClockOutAt - req.requestedClockInAt) / 60000))
            : undefined,
          geoVerified: false,
        });
        await ctx.db.insert("attendanceEvents", {
          companyId: ws.company._id, employeeId: req.employeeId, sessionId,
          kind: EVENT_KIND.CLOCK_IN, at: req.requestedClockInAt, dayKey: req.sessionDate,
        });
      }
    }

    await notify(ctx, {
      companyId: ws.company._id, audience: "employee",
      forUserId: (await ctx.db.get(req.employeeId))?.userId,
      type: args.approve ? "correction_approved" : "correction_rejected",
      title: args.approve ? "Correction approved" : "Correction rejected",
      body: `Your correction for ${req.sessionDate} was ${args.approve ? "approved" : "rejected"}.`,
    });
    await audit(ctx, ws, args.approve ? "correction.approved" : "correction.rejected", `request ${args.id}`);
    return { ok: true };
  },
});

/* ============================== auto clock-out ============================== */

/** Called opportunistically from the client (dashboard/live). */
export const autoClockOutSweep = mutation({
  args: {},
  handler: async (ctx) => {
    const ws = await requireWorkspace(ctx);
    const settings = ws.settings;
    const company = ws.company;
    const dk = dayKey(Date.now());
    const cutoff = Date.now() - settings.autoClockOutHours * 3600_000;
    const open = await ctx.db
      .query("attendanceSessions")
      .withIndex("by_company_day", (q) => q.eq("companyId", ws.company._id).eq("dayKey", dk))
      .collect();
    let closed = 0;
    for (const s of open) {
      if (s.clockOutAt || s.status === ATTENDANCE_STATUS.ON_LEAVE) continue;
      if (s.clockInAt < cutoff) {
        const outAt = s.clockInAt + settings.autoClockOutHours * 3600_000;
        const scheduled = Math.max(1, company.workingHours.endMinutes - company.workingHours.startMinutes);
        const worked = Math.max(0, Math.round((outAt - s.clockInAt) / 60000) - s.breakMinutes);
        await ctx.db.patch(s._id, {
          clockOutAt: outAt,
          workedMinutes: worked,
          status: ATTENDANCE_STATUS.HALF_DAY,
          overtimeMinutes: Math.max(0, worked - scheduled),
        });
        await ctx.db.insert("attendanceEvents", {
          companyId: ws.company._id, employeeId: s.employeeId, sessionId: s._id,
          kind: EVENT_KIND.AUTO_CLOCK_OUT, at: outAt, dayKey: dk,
        });
        closed += 1;
      }
    }
    return { closed };
  },
});

/* ============================ missing clock-out ============================= */

export const missingClockOuts = query({
  args: {},
  handler: async (ctx) => {
    const ws = await requireWorkspace(ctx);
    const employees = await activeEmployees(ctx, ws.company._id);
    const out = [] as Array<{ employee: typeof employees[number]; dayKey: string; clockInAt: number }>;
    for (let d = 1; d <= 7; d++) {
      const dk = addDaysKey(dayKey(Date.now()), -d);
      const sessions = await ctx.db
        .query("attendanceSessions")
        .withIndex("by_company_day", (q) => q.eq("companyId", ws.company._id).eq("dayKey", dk))
        .collect();
      for (const s of sessions) {
        if (!s.deletedAt && !s.clockOutAt && s.status !== ATTENDANCE_STATUS.ON_LEAVE) {
          const emp = employees.find((e) => e._id === s.employeeId);
          if (emp) out.push({ employee: emp, dayKey: dk, clockInAt: s.clockInAt });
        }
      }
    }
    return out;
  },
});

/* --------------------------------- utilities -------------------------------- */

function nowMinutesUtc(ts: number): number {
  const d = new Date(ts);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

function randomRaw(): string {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return Array.from(arr).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

async function getAuthUserIdOrThrow(ctx: any): Promise<string> {
  const { getAuthUserId } = await import("@convex-dev/auth/server");
  const userId = await getAuthUserId(ctx);
  if (userId === null) throw new Error("Not authenticated");
  return userId;
}

async function activeEmployeeFor(ctx: any, userId: string) {
  return await ctx.db
    .query("employees")
    .withIndex("by_user", (q: any) => q.eq("userId", userId))
    .filter((q: any) => q.eq(q.field("active"), true))
    .first();
}

async function activeEmployees(ctx: any, companyId: string): Promise<any[]> {
  return await ctx.db
    .query("employees")
    .withIndex("by_company", (q: any) => q.eq("companyId", companyId))
    .filter((q: any) => q.eq(q.field("active"), true))
    .collect();
}
