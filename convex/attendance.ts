import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import {
  atMinute,
  companySettings,
  dayKey,
  haversineMeters,
  minutesOfDay,
  notifyAdmins,
  randomHex,
  requireEmployee,
  requirePerm,
  sha256Hex,
} from "./helpers";

/**
 * Mints a single-use, short-lived QR code for a wall display. Only the hash is
 * stored, so a database leak cannot be replayed at a door.
 */
export const issueQrToken = mutation({
  args: { displayId: v.id("qrDisplays") },
  handler: async (ctx, args) => {
    const actor = await requirePerm(ctx, "manage_qr");

    const display = await ctx.db.get(args.displayId);
    if (!display || display.companyId !== actor.companyId) {
      throw new Error("That QR display does not belong to your company");
    }
    if (!display.active) {
      throw new Error("That QR display is switched off");
    }

    const settings = await companySettings(ctx, actor.companyId);
    const ttlSeconds = Math.min(
      120,
      Math.max(10, settings?.qrRotationSeconds ?? 30),
    );
    const issuedAt = Date.now();
    const expiresAt = issuedAt + ttlSeconds * 1000;
    const raw = randomHex(32);
    const nonce = randomHex(8);

    await ctx.db.insert("qrTokens", {
      companyId: actor.companyId,
      displayId: display._id,
      tokenHash: sha256Hex(raw),
      nonce,
      issuedAt,
      expiresAt,
    });

    return { token: raw, expiresAt, ttlSeconds, displayId: display._id };
  },
});

/**
 * The scan endpoint. Mirrors the SQL `scan_qr` RPC: match the token hash, reject
 * consumed/expired tokens, verify the display and the caller's own active
 * device, optionally check the geofence, then open or close the day's session.
 */
export const scanQr = mutation({
  args: {
    token: v.string(),
    deviceId: v.id("registeredDevices"),
    latitude: v.optional(v.number()),
    longitude: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const employee = await requireEmployee(ctx);
    const now = Date.now();
    const today = dayKey(now);
    const company = await ctx.db.get(employee.companyId);
    if (!company) throw new Error("Company not found");
    const settings = await companySettings(ctx, employee.companyId);

    const reject = async (reason: string, deviceId?: Id<"registeredDevices">) => {
      await ctx.db.insert("deviceEvents", {
        companyId: employee.companyId,
        deviceId,
        employeeId: employee._id,
        type: "scan_rejected",
        detail: reason,
        actor: employee.email,
        at: now,
      });
      return { ok: false as const, reason };
    };

    const token = await ctx.db
      .query("qrTokens")
      .withIndex("byHash", (q) => q.eq("tokenHash", sha256Hex(args.token.trim())))
      .first();

    if (!token) return await reject("This QR code is not valid");
    if (token.companyId !== employee.companyId) {
      return await reject("This QR code belongs to another company");
    }
    if (token.consumedAt !== undefined) {
      return await reject("This QR code has already been used");
    }
    if (token.expiresAt < now) {
      return await reject("This QR code has expired — scan the next one");
    }

    const display = await ctx.db.get(token.displayId);
    if (!display || display.companyId !== employee.companyId) {
      return await reject("This QR display is not available");
    }
    if (!display.active) {
      return await reject("This QR display is switched off");
    }

    const device = await ctx.db.get(args.deviceId);
    if (!device || device.employeeId !== employee._id) {
      return await reject("That device is not registered to you");
    }
    if (device.status !== "active") {
      return await reject(
        device.status === "revoked"
          ? "That device has been revoked"
          : "That device is waiting for replacement approval",
        device._id,
      );
    }

    // --- Geofence ----------------------------------------------------------
    let geoVerified = false;
    const needsGeo =
      company.geoEnabled || settings?.requireGeo === true;
    if (needsGeo) {
      if (args.latitude === undefined || args.longitude === undefined) {
        return await reject(
          "Location is required to clock in at this office",
          device._id,
        );
      }
      const branches = await ctx.db
        .query("branches")
        .withIndex("byCompany", (q) => q.eq("companyId", employee.companyId))
        .collect();
      const inside = branches.some(
        (branch) =>
          branch.latitude !== undefined &&
          branch.longitude !== undefined &&
          haversineMeters(
            args.latitude as number,
            args.longitude as number,
            branch.latitude,
            branch.longitude,
          ) <= (branch.geofenceRadiusM ?? 250),
      );
      if (!inside) {
        return await reject("You are not at the office location", device._id);
      }
      geoVerified = true;
    }

    // --- Single-use token --------------------------------------------------
    await ctx.db.patch(token._id, { consumedAt: now, consumedBy: employee._id });

    const scheduled = company.endMinute - company.startMinute;
    const existing = await ctx.db
      .query("attendanceSessions")
      .withIndex("byEmployeeDay", (q) =>
        q.eq("employeeId", employee._id).eq("dayKey", today),
      )
      .first();

    const holiday = await ctx.db
      .query("publicHolidays")
      .withIndex("byCompanyDate", (q) =>
        q.eq("companyId", employee.companyId).eq("date", today),
      )
      .first();
    const isWorkDay = company.workDays.includes(
      new Date(`${today}T00:00:00.000Z`).getUTCDay(),
    );
    const dayStatus = holiday ? "holiday" : isWorkDay ? null : "weekend";

    // --- Clock in ----------------------------------------------------------
    if (!existing || existing.clockOutAt !== undefined) {
      const lateMinutes = Math.max(
        0,
        minutesOfDay(now) - company.startMinute - company.lateGraceMinutes,
      );
      const sessionId = await ctx.db.insert("attendanceSessions", {
        companyId: employee.companyId,
        employeeId: employee._id,
        dayKey: today,
        clockInAt: now,
        breakMinutes: 0,
        status: dayStatus ?? "ongoing",
        lateMinutes,
        earlyLeaveMinutes: 0,
        overtimeMinutes: 0,
        clockInDeviceId: device._id,
        clockInDisplayId: display._id,
        geoVerified,
        createdAt: now,
      });

      await ctx.db.insert("attendanceEvents", {
        companyId: employee.companyId,
        employeeId: employee._id,
        sessionId,
        kind: "clock_in",
        at: now,
        dayKey: today,
        deviceId: device._id,
        displayId: display._id,
        geoVerified,
      });

      return { ok: true as const, action: "clock_in" as const, sessionId, lateMinutes };
    }

    // --- Clock out ---------------------------------------------------------
    const workedMinutes = Math.max(
      0,
      Math.round((now - existing.clockInAt) / 60_000) - existing.breakMinutes,
    );
    const earlyLeaveMinutes = Math.max(
      0,
      minutesOfDay(now) - company.endMinute,
    );
    const status =
      workedMinutes < scheduled / 2
        ? ("half_day" as const)
        : existing.lateMinutes > 0
          ? ("late" as const)
          : ("present" as const);

    await ctx.db.patch(existing._id, {
      clockOutAt: now,
      status,
      workedMinutes,
      earlyLeaveMinutes,
      overtimeMinutes: Math.max(0, workedMinutes - scheduled),
      clockOutDeviceId: device._id,
    });

    await ctx.db.insert("attendanceEvents", {
      companyId: employee.companyId,
      employeeId: employee._id,
      sessionId: existing._id,
      kind: "clock_out",
      at: now,
      dayKey: today,
      deviceId: device._id,
      displayId: display._id,
      geoVerified,
    });

    return {
      ok: true as const,
      action: "clock_out" as const,
      sessionId: existing._id,
      workedMinutes,
      status,
    };
  },
});

/** Closes sessions that were left open past the company's auto clock-out limit. */
export const autoClockoutSweep = mutation({
  args: {},
  handler: async (ctx) => {
    const actor = await requirePerm(ctx, "manage_attendance");
    const settings = await companySettings(ctx, actor.companyId);
    const limitHours = settings?.autoClockOutHours ?? 12;
    const cutoff = Date.now() - limitHours * 3_600_000;

    const open = await ctx.db
      .query("attendanceSessions")
      .withIndex("byCompanyDay", (q) => q.eq("companyId", actor.companyId))
      .collect();

    let closed = 0;
    for (const session of open) {
      if (session.clockOutAt !== undefined) continue;
      if (session.clockInAt > cutoff) continue;

      const company = await ctx.db.get(session.companyId);
      if (!company) continue;
      const scheduled = company.endMinute - company.startMinute;
      const workedMinutes = Math.max(
        0,
        Math.round((cutoff - session.clockInAt) / 60_000) - session.breakMinutes,
      );

      await ctx.db.patch(session._id, {
        clockOutAt: cutoff,
        status:
          workedMinutes < scheduled / 2
            ? ("half_day" as const)
            : session.lateMinutes > 0
              ? ("late" as const)
              : ("present" as const),
        workedMinutes,
        overtimeMinutes: Math.max(0, workedMinutes - scheduled),
      });

      await ctx.db.insert("attendanceEvents", {
        companyId: session.companyId,
        employeeId: session.employeeId,
        sessionId: session._id,
        kind: "auto_clock_out",
        at: cutoff,
        dayKey: session.dayKey,
      });
      closed++;
    }

    if (closed > 0) {
      await notifyAdmins(
        ctx,
        actor.companyId,
        "attendance",
        `${closed} session${closed === 1 ? "" : "s"} auto-closed`,
        "Sessions still open past the auto clock-out limit were closed automatically.",
      );
    }

    return { closed };
  },
});

/** Everything the kiosk and "my workspace" screens need for today. */
export const todayStatus = query({
  args: {},
  handler: async (ctx) => {
    const employee = await requireEmployee(ctx);
    const company = await ctx.db.get(employee.companyId);
    if (!company) throw new Error("Company not found");
    const settings = await companySettings(ctx, employee.companyId);
    const today = dayKey(Date.now());

    const session = await ctx.db
      .query("attendanceSessions")
      .withIndex("byEmployeeDay", (q) =>
        q.eq("employeeId", employee._id).eq("dayKey", today),
      )
      .first();

    const devices = await ctx.db
      .query("registeredDevices")
      .withIndex("byEmployee", (q) => q.eq("employeeId", employee._id))
      .collect();

    return {
      today,
      company: {
        startMinute: company.startMinute,
        endMinute: company.endMinute,
        lateGraceMinutes: company.lateGraceMinutes,
        workDays: company.workDays,
        geoEnabled: company.geoEnabled || settings?.requireGeo === true,
      },
      session: session ?? null,
      devices,
      activeDevice: devices.find((d) => d.status === "active") ?? null,
      scheduledMinutes: company.endMinute - company.startMinute,
      shiftStartAt: atMinute(today, company.startMinute),
    };
  },
});
