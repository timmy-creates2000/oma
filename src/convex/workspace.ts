import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { APP_ROLES } from "./schema";
import {
  addDaysKey,
  audit,
  companySettingsFor,
  dayKey,
  dayKeyToDate,
  fmtTime,
  isWorkDay,
  notify,
  requireWorkspace,
  sha256Hex,
} from "./helpers";
import { getAuthUserId } from "@convex-dev/auth/server";

/* --------------------------------- queries --------------------------------- */

export const get = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const employee = await ctx.db
      .query("employees")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .filter((q) => q.eq(q.field("active"), true))
      .first();
    if (!employee) return null;
    const [company, settings] = await Promise.all([
      ctx.db.get(employee.companyId),
      companySettingsFor(ctx, employee.companyId),
    ]);
    const [branch, department] = await Promise.all([
      employee.branchId ? ctx.db.get(employee.branchId) : null,
      employee.departmentId ? ctx.db.get(employee.departmentId) : null,
    ]);
    return { employee, company, settings, branch, department };
  },
});

export const companyOverview = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const employee = await ctx.db
      .query("employees")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .filter((q) => q.eq(q.field("active"), true))
      .first();
    if (!employee) return null;
    const companyId = employee.companyId;
    const branches = await ctx.db.query("branches").withIndex("by_company", (q: any) => q.eq("companyId", companyId)).collect();
      const departments = await ctx.db.query("departments").withIndex("by_company", (q: any) => q.eq("companyId", companyId)).collect();
      const holidayCount = await ctx.db.query("publicHolidays").withIndex("by_company_date", (q: any) => q.eq("companyId", companyId)).collect();
      const leaveTypeCount = await ctx.db.query("leaveTypes").withIndex("by_company", (q: any) => q.eq("companyId", companyId)).collect();
    return {
      branches,
      departments,
      holidays: holidayCount.length,
      leaveTypes: leaveTypeCount.length,
    };
  },
});

/* -------------------------------- mutations -------------------------------- */

export const createCompany = mutation({
  args: {
    companyName: v.string(),
    industry: v.optional(v.string()),
    startMinutes: v.number(),
    endMinutes: v.number(),
    lateGraceMinutes: v.number(),
    workDays: v.array(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const user = await ctx.db.get(userId);
    if (!user) throw new Error("Not authenticated");
    if (!user.email) throw new Error("Your account has no email; use email sign-in.");

    const existing = await ctx.db
      .query("employees")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .filter((q) => q.eq(q.field("active"), true))
      .first();
    if (existing) throw new Error("You already belong to a company.");

    const slugBase = args.companyName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "company";
    let slug = slugBase;
    for (let i = 0; i < 5; i++) {
      const clash = await ctx.db.query("companies").withIndex("by_slug", (q) => q.eq("slug", slug)).first();
      if (!clash) break;
      slug = `${slugBase}-${Math.floor(Math.random() * 9000 + 1000)}`;
    }

    const companyId = await ctx.db.insert("companies", {
      name: args.companyName,
      slug,
      industry: args.industry,
      workingHours: {
        startMinutes: args.startMinutes,
        endMinutes: args.endMinutes,
        lateGraceMinutes: args.lateGraceMinutes,
        workDays: args.workDays,
      },
      geoVerification: false,
      createdAt: Date.now(),
      createdBy: userId,
    });
    await companySettingsFor(ctx, companyId);

    const employeeId = await ctx.db.insert("employees", {
      companyId,
      userId,
      email: user.email,
      name: user.name ?? user.email.split("@")[0],
      employeeCode: "EMP-001",
      role: APP_ROLES.COMPANY_ADMIN,
      position: "Founder / Admin",
      joinedAt: Date.now(),
      active: true,
    });

    await ctx.db.insert("leaveTypes", {
      companyId,
      name: "Annual Leave",
      annualQuotaDays: 20,
      paid: true,
    });
    await ctx.db.insert("leaveTypes", {
      companyId,
      name: "Sick Leave",
      annualQuotaDays: 10,
      paid: true,
    });
    await ctx.db.insert("leaveTypes", {
      companyId,
      name: "Unpaid Leave",
      annualQuotaDays: 30,
      paid: false,
    });

    await ctx.db.insert("auditLogs", {
      companyId,
      actorEmail: user.email,
      action: "company.created",
      detail: `Company ${args.companyName} created`,
      at: Date.now(),
    });

    return { companyId, employeeId };
  },
});

export const joinByCode = mutation({
  args: { code: v.string() },
  handler: async (ctx, args) => theJoinHandler(ctx, args.code),
});

async function theJoinHandler(ctx: any, code: string) {
  const userId = await getAuthUserId(ctx);
  if (userId === null) throw new Error("Not authenticated");
  const user = await ctx.db.get(userId);
  if (!user?.email) throw new Error("Not authenticated or no email on account");

  const parts = code.trim().split(":");
  if (parts.length !== 2) throw new Error("Invalid invite code format. Use slug:email?... or slug:EMP-XXX");
  const [slug, suffix] = parts;

  const company = await ctx.db.query("companies").withIndex("by_slug", (q: any) => q.eq("slug", slug)).first();
  if (!company) throw new Error(`No company found for code "${slug}"`);

  // Case A: suffix is an employee code → claim that seat
  let employee: any = await ctx.db
    .query("employees")
    .withIndex("by_company_email", (q: any) => q.eq("companyId", company._id).eq("email", user.email))
    .first();

  if (employee) {
    if (employee.active) throw new Error("You are already an active member of this company.");
    await ctx.db.patch(employee._id, { userId, active: true });
  } else if (/^EMP-/i.test(suffix)) {
    const target = await ctx.db
      .query("employees")
      .withIndex("by_company", (q: any) => q.eq("companyId", company._id))
      .collect()
      .then((rows: any[]) => rows.find((r) => r.employeeCode.toLowerCase() === suffix.toLowerCase()));
    if (!target) throw new Error(`No seat with employee code ${suffix} in this company.`);
    if (target.userId) throw new Error("That seat already belongs to another user.");
    if (!target.active) throw new Error("That seat is inactive.");
    await ctx.db.patch(target._id, { userId, active: true });
    employee = await ctx.db.get(target._id);
  } else {
    throw new Error("No pending seat for your email and the code suffix didn't match an employee code.");
  }

  await ctx.db.insert("auditLogs", {
    companyId: company._id,
    actorEmail: user.email,
    action: "employee.joined",
    detail: `${user.email} claimed seat ${employee!.employeeCode}`,
    at: Date.now(),
  });
  return { companyId: company._id, employeeId: employee!._id };
}

/* ------------------------------- demo seeding ------------------------------ */

const DEMO_NAMES = [
  "Amara Okafor", "Liam Chen", "Sofia Reyes", "Noah Kimura", "Priya Sharma",
  "Mateo Alvarez", "Zara Ahmed", "Ethan Brooks", "Mia Novak", "Kenji Sato",
  "Lena Fischer", "Omar Haddad", "Grace Mwangi", "Tomas Novotny", "Ivy Laurent",
  "Ravi Patel", "Hana Yoshida", "Diego Morales", "Nora Lindqvist", "Sam Osei",
];

const DEMO_POSITIONS = [
  "Engineering Manager", "Senior Engineer", "Product Designer", "People Partner",
  "Data Analyst", "Account Executive", "Support Lead", "QA Engineer",
];

export const seedDemoData = mutation({
  args: { companyId: v.id("companies") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const company = await ctx.db.get(args.companyId);
    if (!company) throw new Error("Company not found");
    const me = await ctx.db
      .query("employees")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .filter((q) => q.eq(q.field("active"), true))
      .first();
    if (!me || me.companyId !== args.companyId) throw new Error("Forbidden");

    const wh = company.workingHours;
    const today = dayKey(Date.now());
    const now = Date.now();

    // branches
    const mainBranch = await ctx.db.insert("branches", {
      companyId: company._id, name: "HQ — Main Campus", address: "1 Harbor Way",
      latitude: 37.7749, longitude: -122.4194, geofenceRadiusM: 150,
    });
    await ctx.db.insert("branches", {
      companyId: company._id, name: "Riverside Office", address: "88 River Rd",
      latitude: 37.7850, longitude: -122.4050, geofenceRadiusM: 120,
    });

    // departments
    const eng = await ctx.db.insert("departments", { companyId: company._id, name: "Engineering" });
    const design = await ctx.db.insert("departments", { companyId: company._id, name: "Design" });
    const people = await ctx.db.insert("departments", { companyId: company._id, name: "People Ops" });
    const sales = await ctx.db.insert("departments", { companyId: company._id, name: "Sales" });

    // employees (22 total incl. the creator)
    const deptIds = [eng, design, people, sales];
    const employeeRows: Array<{ id: any; name: string; email: string; deptId: any; role: string }> = [];
    let counter = 1;
    const founder = await ctx.db
      .query("employees")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    employeeRows.push({ id: founder!._id, name: founder!.name, email: founder!.email, deptId: people, role: "company_admin" });

    for (const name of DEMO_NAMES) {
      counter += 1;
      const email = `${name.toLowerCase().replace(/[^a-z]+/g, ".")}@demo.officeflow.app`;
      const role = counter === 2 ? APP_ROLES.HR_ADMIN : counter === 3 ? APP_ROLES.MANAGER : APP_ROLES.EMPLOYEE;
      const id = await ctx.db.insert("employees", {
        companyId: company._id,
        email,
        name,
        employeeCode: `EMP-${String(counter).padStart(3, "0")}`,
        role,
        departmentId: deptIds[counter % deptIds.length],
        branchId: counter % 5 === 0 ? undefined : mainBranch,
        position: DEMO_POSITIONS[counter % DEMO_POSITIONS.length],
        joinedAt: now - (counter * 86400000 * 37),
        active: true,
      });
      employeeRows.push({ id, name, email, deptId: deptIds[counter % deptIds.length], role });
    }

    // public holidays (past + upcoming)
    await ctx.db.insert("publicHolidays", { companyId: company._id, date: addDaysKey(today, -12), name: "Founders Day" });
    await ctx.db.insert("publicHolidays", { companyId: company._id, date: addDaysKey(today, 9), name: "Wellness Day" });
    await ctx.db.insert("publicHolidays", { companyId: company._id, date: addDaysKey(today, 24), name: "Summer Festival" });

    // leave requests & balances
    const leaveTypes = await ctx.db.query("leaveTypes").withIndex("by_company", (q) => q.eq("companyId", company._id)).collect();
    const annual = leaveTypes.find((t) => t.name === "Annual Leave")!;
    const sick = leaveTypes.find((t) => t.name === "Sick Leave")!;

    for (const emp of employeeRows) {
      await ctx.db.insert("leaveBalances", {
        companyId: company._id, employeeId: emp.id, leaveTypeId: annual._id,
        year: new Date().getUTCFullYear(), usedDays: 0,
      });
      await ctx.db.insert("leaveBalances", {
        companyId: company._id, employeeId: emp.id, leaveTypeId: sick._id,
        year: new Date().getUTCFullYear(), usedDays: 0,
      });
    }

    const approvedLeaves: Array<{ employeeId: any; start: string; end: string }> = [];
    const leaveSeeds: Array<{ empIdx: number; type: any; offset: number; days: number; status: string }> = [
      { empIdx: 2, type: annual, offset: -6, days: 3, status: "approved" },
      { empIdx: 4, type: sick, offset: 0, days: 1, status: "approved" },
      { empIdx: 5, type: annual, offset: 4, days: 2, status: "approved" },
      { empIdx: 7, type: annual, offset: 2, days: 5, status: "pending" },
      { empIdx: 9, type: sick, offset: 1, days: 1, status: "pending" },
      { empIdx: 11, type: annual, offset: 10, days: 4, status: "pending" },
      { empIdx: 13, type: annual, offset: -20, days: 2, status: "approved" },
    ];
    for (const seed of leaveSeeds) {
      const emp = employeeRows[seed.empIdx];
      const start = addDaysKey(today, seed.offset);
      const end = addDaysKey(start, seed.days - 1);
      await ctx.db.insert("leaveRequests", {
        companyId: company._id, employeeId: emp.id, leaveTypeId: seed.type._id,
        startDate: start, endDate: end, reason: seed.status === "pending" ? "Family plans" : seed.type.name === "Sick Leave" ? "Flu" : "Vacation",
        status: seed.status as any,
        decidedBy: seed.status === "approved" ? "hr@demo.officeflow.app" : undefined,
        decidedAt: seed.status === "approved" ? now - 86400000 * 2 : undefined,
        createdAt: now - 86400000 * 3,
      });
      if (seed.status === "approved") {
        approvedLeaves.push({ employeeId: emp.id, start, end });
        const bal = await ctx.db.query("leaveBalances")
          .withIndex("by_employee_type", (q) => q.eq("employeeId", emp.id).eq("leaveTypeId", seed.type._id)).first();
        if (bal) await ctx.db.patch(bal._id, { usedDays: bal.usedDays + seed.days });
      }
    }

    // devices for most employees
    const deviceRows: Array<{ id: any; employeeId: any }> = [];
    for (let i = 0; i < employeeRows.length; i++) {
      const emp = employeeRows[i];
      if (i === 6) continue; // one employee without a device yet
      const fingerprint = await sha256Hex(`demo:${emp.email}:device-key`);
      const id = await ctx.db.insert("registeredDevices", {
        companyId: company._id, employeeId: emp.id,
        label: i % 3 === 0 ? "iPhone 15" : i % 3 === 1 ? "Pixel 8" : "Galaxy S24",
        platform: i % 3 === 0 ? "iOS" : "Android",
        publicKeyFingerprint: fingerprint.slice(0, 32),
        status: i === 8 ? "pending_replacement" : "active",
        registeredAt: now - 86400000 * (10 + i),
      });
      deviceRows.push({ id, employeeId: emp.id });
      await ctx.db.insert("deviceEvents", {
        companyId: company._id, deviceId: id, employeeId: emp.id,
        type: "registered", detail: "Device registered during onboarding",
        actor: emp.email, at: now - 86400000 * (10 + i),
      });
    }

    // QR displays
    const disp1 = await ctx.db.insert("qrDisplays", {
      companyId: company._id, branchId: mainBranch, label: "Lobby Kiosk — Main", active: true, createdAt: now - 86400000 * 30,
    });
    await ctx.db.insert("qrDisplays", {
      companyId: company._id, branchId: mainBranch, label: "Elevator Bank — Floor 3", active: true, createdAt: now - 86400000 * 30,
    });
    await ctx.db.insert("qrDisplays", {
      companyId: company._id, branchId: undefined, label: "Riverside Reception", active: false, createdAt: now - 86400000 * 5,
    });

    // 30 days of attendance history
    const rand = mulberry32(42);
    for (let d = 30; d >= 1; d--) {
      const dk = addDaysKey(today, -d);
      if (!isWorkDay(wh, dk)) continue;
      const holiday = await ctx.db.query("publicHolidays")
        .withIndex("by_company_date", (q) => q.eq("companyId", company._id).eq("date", dk)).first();
      if (holiday) continue;

      for (const emp of employeeRows) {
        if (isOnLeave(approvedLeaves, emp.id, dk)) {
          await ctx.db.insert("attendanceSessions", {
            companyId: company._id, employeeId: emp.id, dayKey: dk,
            clockInAt: dayKeyToDate(dk).getTime() + wh.startMinutes * 60000,
            breakMinutes: 0, status: "on_leave",
            lateMinutes: 0, earlyLeaveMinutes: 0, overtimeMinutes: 0,
            geoVerified: false,
          });
          continue;
        }
        const r = rand();
        if (r < 0.06) continue; // absent
        const late = rand() < 0.14;
        const inMin = wh.startMinutes + (late ? 15 + Math.floor(rand() * 60) : -14 + Math.floor(rand() * 20));
        const clockInAt = dayKeyToDate(dk).getTime() + inMin * 60000;
        const outMin = wh.endMinutes + (rand() < 0.18 ? 20 + Math.floor(rand() * 90) : -10 + Math.floor(rand() * 25));
        const clockOutAt = dayKeyToDate(dk).getTime() + outMin * 60000;
        const breakMinutes = 45 + Math.floor(rand() * 30);
        const worked = Math.max(0, Math.round((clockOutAt - clockInAt) / 60000) - breakMinutes);
        const scheduled = Math.max(1, wh.endMinutes - wh.startMinutes);
        const lateMinutes = Math.max(0, inMin - (wh.startMinutes + wh.lateGraceMinutes));
        const earlyLeave = Math.max(0, wh.endMinutes - outMin);
        const overtime = Math.max(0, worked - scheduled);
        const status = worked < scheduled / 2 ? "half_day" : late ? "late" : "present";
        const session = await ctx.db.insert("attendanceSessions", {
          companyId: company._id, employeeId: emp.id, dayKey: dk,
          clockInAt, clockOutAt, breakMinutes, status,
          lateMinutes, earlyLeaveMinutes: earlyLeave, overtimeMinutes: overtime,
          workedMinutes: worked,
          clockInDeviceId: deviceRows.find((x) => x.employeeId === emp.id)?.id,
          geoVerified: false,
        });
        await ctx.db.insert("attendanceEvents", {
          companyId: company._id, employeeId: emp.id, sessionId: session,
          kind: "clock_in", at: clockInAt, dayKey: dk, deviceId: deviceRows.find((x) => x.employeeId === emp.id)?.id,
        });
        await ctx.db.insert("attendanceEvents", {
          companyId: company._id, employeeId: emp.id, sessionId: session,
          kind: "clock_out", at: clockOutAt, dayKey: dk,
        });
      }
    }

    // today: some already clocked in (staggered so dashboard looks live)
    const todayTs = dayKeyToDate(today).getTime();
    const onLeaveToday = new Set(approvedLeaves.filter((l) => l.start <= today && l.end >= today).map((l) => l.employeeId));
    for (let i = 0; i < employeeRows.length; i++) {
      const emp = employeeRows[i];
      if (onLeaveToday.has(emp.id)) {
        await ctx.db.insert("attendanceSessions", {
          companyId: company._id, employeeId: emp.id, dayKey: today,
          clockInAt: todayTs + wh.startMinutes * 60000,
          breakMinutes: 0, status: "on_leave", lateMinutes: 0, earlyLeaveMinutes: 0, overtimeMinutes: 0,
          geoVerified: false,
        });
        continue;
      }
      if (i % 7 === 6) continue; // absent / not arrived today
      const late = i % 9 === 4;
      const inMin = wh.startMinutes + (late ? 12 + Math.floor(rand() * 40) : -18 + Math.floor(rand() * 25));
      const clockInAt = todayTs + Math.max(0, inMin) * 60000;
      if (clockInAt > now) continue;
      const dev = deviceRows.find((x) => x.employeeId === emp.id)?.id;
      const lateMinutes = Math.max(0, inMin - (wh.startMinutes + wh.lateGraceMinutes));
      const session = await ctx.db.insert("attendanceSessions", {
        companyId: company._id, employeeId: emp.id, dayKey: today,
        clockInAt, breakMinutes: 0, status: late ? "late" : "present",
        lateMinutes, earlyLeaveMinutes: 0, overtimeMinutes: 0,
        clockInDeviceId: dev, geoVerified: false,
      });
      await ctx.db.insert("attendanceEvents", {
        companyId: company._id, employeeId: emp.id, sessionId: session,
        kind: "clock_in", at: clockInAt, dayKey: today, deviceId: dev,
      });
      // ~half already clocked out (only for past timestamps)
      const outMin = wh.endMinutes - 15;
      const clockOutAt = todayTs + outMin * 60000;
      if (clockOutAt < now && i % 2 === 0) {
        const worked = Math.max(0, Math.round((clockOutAt - clockInAt) / 60000) - 45);
        const scheduled = Math.max(1, wh.endMinutes - wh.startMinutes);
        await ctx.db.patch(session, {
          clockOutAt,
          workedMinutes: worked,
          status: worked < scheduled / 2 ? "half_day" : late ? "late" : "present",
          earlyLeaveMinutes: Math.max(0, wh.endMinutes - outMin),
          overtimeMinutes: Math.max(0, worked - scheduled),
        });
        await ctx.db.insert("attendanceEvents", {
          companyId: company._id, employeeId: emp.id, sessionId: session,
          kind: "clock_out", at: clockOutAt, dayKey: today,
        });
      }
    }

    // a couple of correction requests
    await ctx.db.insert("correctionRequests", {
      companyId: company._id, employeeId: employeeRows[4].id,
      sessionDate: addDaysKey(today, -3),
      requestedClockInAt: todayTs - 3 * 86400000 + (wh.startMinutes - 5) * 60000,
      reason: "Forgot to scan at the door — badge log confirms 8:55 arrival.",
      status: "pending", createdAt: now - 86400000,
    });
    await ctx.db.insert("correctionRequests", {
      companyId: company._id, employeeId: employeeRows[7].id,
      sessionDate: addDaysKey(today, -5),
      reason: "Attended offsite client meeting, clock-in not possible.",
      status: "pending", createdAt: now - 86400000 * 2,
    });

    // seed notifications
    await notify(ctx, {
      companyId: company._id, audience: "admins",
      type: "leave_pending", title: "Leave requests awaiting review",
      body: "3 leave requests are pending approval.",
    });
    await notify(ctx, {
      companyId: company._id, audience: "admins",
      type: "device_pending", title: "Device replacement requested",
      body: "Mia Novak requested a device replacement.",
    });
    const meUser = await ctx.db.get(userId);
    await audit(ctx, { company, user: meUser! }, "demo.seeded", "Demo dataset generated");
    return { ok: true };
  },
});

/* --------------------------------- helpers --------------------------------- */

function isOnLeave(
  leaves: Array<{ employeeId: any; start: string; end: string }>,
  employeeId: string,
  dk: string,
): boolean {
  return leaves.some((l) => l.employeeId === employeeId && l.start <= dk && dk <= l.end);
}

function mulberry32(seed: number) {
  let a = seed;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
