import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import {
  atMinute,
  dateOnly,
  dayKey,
  minutesOfDay,
  myEmployee,
  shiftDay,
  slugify,
  workDaysBetween,
} from "./helpers";

/**
 * Everything the app shell needs on boot: who the user is, which company they
 * belong to, and their role-derived permissions.
 */
export const myWorkspace = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    const userId = identity?.subject as Id<"users"> | undefined;
    const employee = await myEmployee(ctx);
    // Signed in, but not a member of any company yet → onboarding takes over.
    if (!employee) return null;

    const company = await ctx.db.get(employee.companyId);
    const settings = await ctx.db
      .query("companySettings")
      .withIndex("byCompany", (q) => q.eq("companyId", employee.companyId))
      .first();
    const departments = await ctx.db
      .query("departments")
      .withIndex("byCompany", (q) => q.eq("companyId", employee.companyId))
      .collect();
    const branches = await ctx.db
      .query("branches")
      .withIndex("byCompany", (q) => q.eq("companyId", employee.companyId))
      .collect();

    const unread = await ctx.db
      .query("notifications")
      .withIndex("byCompanyUnread", (q) =>
        q.eq("companyId", employee.companyId).eq("readAt", undefined),
      )
      .collect();

    return {
      user: {
        id: userId ?? null,
        email: identity?.email ?? null,
        name: identity?.name ?? null,
      },
      employee,
      company,
      settings,
      departments,
      branches,
      unreadCount: unread.filter(
        (n) =>
          n.forUserId === undefined ||
          (userId !== undefined && n.forUserId === userId) ||
          n.audience === "admins",
      ).length,
    };
  },
});

export const createCompany = mutation({
  args: {
    name: v.string(),
    industry: v.optional(v.string()),
    startMinute: v.number(),
    endMinute: v.number(),
    lateGraceMinutes: v.number(),
    workDays: v.array(v.number()),
    geoEnabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("You must be signed in");
    const email = identity.email;
    if (!email) throw new Error("Your account has no email address");
    const userId = identity.subject as Id<"users">;

    // One company per user, enforced the same way the SQL version did it.
    const existing = await ctx.db
      .query("employees")
      .withIndex("byUser", (q) => q.eq("userId", userId))
      .first();
    if (existing) throw new Error("You already belong to a company");

    const now = Date.now();
    const companyId = await ctx.db.insert("companies", {
      name: args.name,
      slug: `${slugify(args.name)}-${Math.random().toString(36).slice(2, 7)}`,
      industry: args.industry,
      startMinute: args.startMinute,
      endMinute: args.endMinute,
      lateGraceMinutes: args.lateGraceMinutes,
      workDays: args.workDays,
      geoEnabled: args.geoEnabled,
      createdBy: userId,
      createdAt: now,
    });

    await ctx.db.insert("companySettings", {
      companyId,
      qrRotationSeconds: 30,
      requireGeo: false,
      autoClockOutHours: 12,
      retentionDays: 365,
    });

    const year = new Date(now).getUTCFullYear();
    const leaveTypes: { id: Id<"leaveTypes">; name: string }[] = [];
    for (const [name, quota, paid] of [
      ["Annual Leave", 20, true],
      ["Sick Leave", 10, true],
      ["Unpaid Leave", 30, false],
    ] as const) {
      const leaveTypeId = await ctx.db.insert("leaveTypes", {
        companyId,
        name,
        annualQuotaDays: quota,
        paid,
      });
      leaveTypes.push({ id: leaveTypeId, name });
    }

    const employeeId = await ctx.db.insert("employees", {
      companyId,
      userId,
      email,
      name: identity.name ?? email,
      employeeCode: "EMP-001",
      role: "company_admin",
      joinedAt: now,
      active: true,
    });

    for (const type of leaveTypes) {
      await ctx.db.insert("leaveBalances", {
        companyId,
        employeeId,
        leaveTypeId: type.id,
        year,
        usedDays: 0,
      });
    }

    await ctx.db.insert("auditLogs", {
      companyId,
      actorEmail: email,
      action: "company.created",
      detail: args.name,
      at: now,
    });

    return { companyId, employeeId };
  },
});

export const joinCompany = mutation({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.email) throw new Error("You must be signed in with an email");

    const company = await ctx.db
      .query("companies")
      .withIndex("bySlug", (q) => q.eq("slug", args.slug.trim()))
      .first();
    if (!company) throw new Error("No company matches that invite code");

    const already = await ctx.db
      .query("employees")
      .withIndex("byUser", (q) =>
        q.eq("userId", identity.subject as Id<"users">),
      )
      .first();
    if (already) throw new Error("You already belong to a company");

    const now = Date.now();
    const count = await ctx.db
      .query("employees")
      .withIndex("byCompany", (q) => q.eq("companyId", company._id))
      .collect();

    const employeeId = await ctx.db.insert("employees", {
      companyId: company._id,
      userId: identity.subject as Id<"users">,
      email: identity.email,
      name: identity.name ?? identity.email,
      employeeCode: `EMP-${String(count.length + 1).padStart(3, "0")}`,
      role: "employee",
      joinedAt: now,
      active: true,
    });

    const year = new Date(now).getUTCFullYear();
    const types = await ctx.db
      .query("leaveTypes")
      .withIndex("byCompany", (q) => q.eq("companyId", company._id))
      .collect();
    for (const type of types) {
      await ctx.db.insert("leaveBalances", {
        companyId: company._id,
        employeeId,
        leaveTypeId: type._id,
        year,
        usedDays: 0,
      });
    }

    await ctx.db.insert("auditLogs", {
      companyId: company._id,
      actorEmail: identity.email,
      action: "employee.joined",
      detail: identity.email,
      at: now,
    });

    return { employeeId };
  },
});

const DEMO_NAMES = [
  "Priya Raman",
  "Daniel Okafor",
  "Mei Lin",
  "Tomás Rivera",
  "Aisha Bello",
  "Jonas Weber",
  "Sofia Marino",
  "Arjun Mehta",
  "Clara Dubois",
  "Noah Andersen",
  "Yuki Tanaka",
  "Fatima Zahra",
  "Liam O'Brien",
  "Zanele Dlamini",
  "Marta Kowalski",
  "Ravi Deshmukh",
  "Elena Petrova",
  "Hugo Silva",
  "Nadia Haddad",
  "Oliver Grant",
];

const DEMO_POSITIONS = [
  "People Ops Lead",
  "Engineering Manager",
  "Software Engineer",
  "Product Designer",
  "Account Executive",
  "Finance Analyst",
  "Support Specialist",
  "Data Analyst",
  "Marketing Manager",
  "Recruiter",
  "QA Engineer",
  "Operations Coordinator",
  "Backend Engineer",
  "Frontend Engineer",
  "Customer Success Manager",
  "Business Analyst",
  "Office Manager",
  "Content Strategist",
  "Sales Development Rep",
  "IT Administrator",
];

const DEMO_DEPARTMENTS = ["Engineering", "Sales", "People", "Finance"];
const DEMO_BRANCHES = ["Headquarters", "Riverside Campus"];

/** Populates a new company with a realistic 21-person demo office. */
export const seedDemo = mutation({
  args: { companyId: v.id("companies") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("You must be signed in");

    const company = await ctx.db.get(args.companyId);
    if (!company) throw new Error("Company not found");

    const admin = await ctx.db
      .query("employees")
      .withIndex("byCompany", (q) => q.eq("companyId", args.companyId))
      .filter((q) => q.eq(q.field("role"), "company_admin"))
      .first();
    if (!admin) throw new Error("Create the company before seeding demo data");

    const alreadySeeded = await ctx.db
      .query("employees")
      .withIndex("byCompany", (q) => q.eq("companyId", args.companyId))
      .collect();
    if (alreadySeeded.length > 1) {
      throw new Error("Demo data has already been added to this company");
    }

    const now = Date.now();
    const today = dayKey(now);
    const year = new Date(now).getUTCFullYear();
    const scheduled = company.endMinute - company.startMinute;

    // --- Branches and departments -------------------------------------------
    const branchIds: Id<"branches">[] = [];
    for (const [i, name] of DEMO_BRANCHES.entries()) {
      branchIds.push(
        await ctx.db.insert("branches", {
          companyId: args.companyId,
          name,
          address: i === 0 ? "1 Harbour Way, Central" : "88 Riverside Drive",
          latitude: i === 0 ? 51.5072 : 51.4945,
          longitude: i === 0 ? -0.1276 : -0.1021,
          geofenceRadiusM: 250,
        }),
      );
    }

    const departmentIds: Id<"departments">[] = [];
    for (const name of DEMO_DEPARTMENTS) {
      departmentIds.push(
        await ctx.db.insert("departments", { companyId: args.companyId, name }),
      );
    }

    // --- Employees ----------------------------------------------------------
    const employees: {
      id: Id<"employees">;
      index: number;
      hasDevice: boolean;
    }[] = [{ id: admin._id, index: 0, hasDevice: true }];

    for (let i = 0; i < DEMO_NAMES.length; i++) {
      const name = DEMO_NAMES[i];
      const code = `EMP-${String(i + 2).padStart(3, "0")}`;
      const email = `${name
        .toLowerCase()
        .normalize("NFD")
        .replace(/[^a-z ]/g, "")
        .trim()
        .replace(/\s+/g, ".")}@officeflow.demo`;

      // index 6 (EMP-008) deliberately has no device, so the "needs a device"
      // flow is visible in the demo.
      const hasDevice = i !== 6;
      const role =
        i === 0 ? "hr_admin" : i === 1 ? "manager" : ("employee" as const);

      const employeeId = await ctx.db.insert("employees", {
        companyId: args.companyId,
        email,
        name,
        employeeCode: code,
        role,
        departmentId: departmentIds[i % departmentIds.length],
        branchId: branchIds[i % branchIds.length],
        position: DEMO_POSITIONS[i],
        managerEmail: admin.email,
        joinedAt: now - (400 - i * 7) * 86_400_000,
        active: true,
      });

      if (hasDevice) {
        await ctx.db.insert("registeredDevices", {
          companyId: args.companyId,
          employeeId,
          label: `${name.split(" ")[0]}'s phone`,
          platform: i % 3 === 0 ? "Android" : i % 3 === 1 ? "iOS" : "Web",
          publicKeyFingerprint: `fp_${code.toLowerCase()}_${Math.random()
            .toString(36)
            .slice(2, 10)}`,
          status: "active",
          registeredAt: now - (300 - i) * 86_400_000,
        });
      }

      employees.push({ id: employeeId, index: i + 1, hasDevice });
    }

    // --- Leave balances -----------------------------------------------------
    const leaveTypes = await ctx.db
      .query("leaveTypes")
      .withIndex("byCompany", (q) => q.eq("companyId", args.companyId))
      .collect();

    for (const emp of employees) {
      for (const type of leaveTypes) {
        await ctx.db.insert("leaveBalances", {
          companyId: args.companyId,
          employeeId: emp.id,
          leaveTypeId: type._id,
          year,
          usedDays: type.name === "Annual Leave" ? (emp.index % 7) : 0,
        });
      }
    }

    // --- Public holidays ----------------------------------------------------
    for (const offset of [12, 40, 96]) {
      await ctx.db.insert("publicHolidays", {
        companyId: args.companyId,
        date: shiftDay(today, offset),
        name: offset === 12 ? "Founders Day" : offset === 40 ? "Spring Break" : "Winter Holiday",
      });
    }

    // --- QR displays --------------------------------------------------------
    for (const [i, label] of ["Lobby entrance", "Cafeteria", "Riverside gate"].entries()) {
      await ctx.db.insert("qrDisplays", {
        companyId: args.companyId,
        branchId: branchIds[i % branchIds.length],
        label,
        active: true,
        createdAt: now,
      });
    }

    // --- Leave requests -----------------------------------------------------
    const annual = leaveTypes[0];
    const sick = leaveTypes[1];
    if (annual && sick) {
      const plan: {
        code: string;
        type: Id<"leaveTypes">;
        start: number;
        end: number;
        status: "approved" | "pending";
        reason: string;
      }[] = [
        { code: "EMP-002", type: annual._id, start: -20, end: -18, status: "approved", reason: "Family trip" },
        { code: "EMP-004", type: annual._id, start: 6, end: 9, status: "approved", reason: "Summer holiday" },
        { code: "EMP-005", type: sick._id, start: -3, end: -3, status: "approved", reason: "Migraine" },
        { code: "EMP-013", type: annual._id, start: 14, end: 16, status: "approved", reason: "Wedding" },
        { code: "EMP-007", type: annual._id, start: 3, end: 5, status: "pending", reason: "Long weekend" },
        { code: "EMP-009", type: sick._id, start: 1, end: 1, status: "pending", reason: "Dental appointment" },
        { code: "EMP-011", type: annual._id, start: 21, end: 24, status: "pending", reason: "Passport renewal" },
      ];

      for (const row of plan) {
        const emp = employees.find((e) => e.id && row.code === `EMP-${String(e.index + 1).padStart(3, "0")}`);
        if (!emp) continue;
        await ctx.db.insert("leaveRequests", {
          companyId: args.companyId,
          employeeId: emp.id,
          leaveTypeId: row.type,
          startDate: shiftDay(today, row.start),
          endDate: shiftDay(today, row.end),
          reason: row.reason,
          status: row.status,
          decidedBy: row.status === "approved" ? admin.email : undefined,
          decidedAt: row.status === "approved" ? now - 5 * 86_400_000 : undefined,
          decisionNote: row.status === "approved" ? "Enjoy!" : undefined,
          createdAt: now - 7 * 86_400_000,
        });
      }
    }

    // --- Correction requests ------------------------------------------------
    const corrections: { code: string; days: number; note: string }[] = [
      { code: "EMP-005", days: -3, note: "Badge did not scan, I was at my desk." },
      { code: "EMP-008", days: -5, note: "Phone was dead, forgot to check in." },
    ];
    for (const row of corrections) {
      const emp = employees.find((e) => row.code === `EMP-${String(e.index + 1).padStart(3, "0")}`);
      if (!emp) continue;
      await ctx.db.insert("correctionRequests", {
        companyId: args.companyId,
        employeeId: emp.id,
        sessionDate: shiftDay(today, row.days),
        requestedClockInAt: atMinute(shiftDay(today, row.days), company.startMinute - 4),
        reason: row.note,
        status: "pending",
        createdAt: now - 2 * 86_400_000,
      });
    }

    // --- Admin notifications ------------------------------------------------
    await ctx.db.insert("notifications", {
      companyId: args.companyId,
      audience: "admins",
      type: "device",
      title: "Device needs attention",
      body: "EMP-008 has no registered device yet.",
      createdAt: now - 3 * 3_600_000,
    });
    await ctx.db.insert("notifications", {
      companyId: args.companyId,
      audience: "admins",
      type: "leave",
      title: "3 leave requests waiting",
      body: "Review the pending requests in the Leave inbox.",
      createdAt: now - 9_000_000,
    });

    // --- Attendance history (last 30 days) ----------------------------------
    for (let back = 30; back >= 1; back--) {
      const day = shiftDay(today, -back);
      if (!company.workDays.includes(new Date(`${day}T00:00:00.000Z`).getUTCDay())) {
        continue;
      }
      for (const emp of employees) {
        if (!emp.hasDevice && emp.index % 3 !== 0) continue;
        const absent = (emp.index * 7 + back * 13) % 17 === 0;
        if (absent) continue;

        const jitter = ((emp.index * 7 + back * 13) % 25) - 8;
        const clockInAt = atMinute(day, company.startMinute + jitter);
        const lateMinutes = Math.max(0, jitter - company.lateGraceMinutes);
        const workedMinutes = Math.max(
          60,
          scheduled - 20 + ((emp.index * 11 + back * 5) % 90),
        );

        await ctx.db.insert("attendanceSessions", {
          companyId: args.companyId,
          employeeId: emp.id,
          dayKey: day,
          clockInAt,
          clockOutAt: clockInAt + workedMinutes * 60_000,
          breakMinutes: 30,
          status:
            workedMinutes < scheduled / 2 ? "half_day" : lateMinutes > 0 ? "late" : "present",
          lateMinutes,
          earlyLeaveMinutes: 0,
          overtimeMinutes: Math.max(0, workedMinutes - scheduled),
          workedMinutes,
          geoVerified: emp.index % 2 === 0,
          createdAt: clockInAt,
        });
      }
    }

    // --- Today: staggered arrivals -----------------------------------------
    const displays = await ctx.db
      .query("qrDisplays")
      .withIndex("byCompany", (q) => q.eq("companyId", args.companyId))
      .collect();

    for (const emp of employees) {
      if (!emp.hasDevice) continue;
      const planned = atMinute(today, company.startMinute - 10 + emp.index * 2);
      if (planned > now) continue;
      const lateMinutes = Math.max(0, minutesOfDay(planned) - company.startMinute - company.lateGraceMinutes);
      await ctx.db.insert("attendanceSessions", {
        companyId: args.companyId,
        employeeId: emp.id,
        dayKey: today,
        clockInAt: planned,
        breakMinutes: 0,
        status: "ongoing",
        lateMinutes,
        earlyLeaveMinutes: 0,
        overtimeMinutes: 0,
        clockInDisplayId: displays[emp.index % displays.length]?._id,
        geoVerified: emp.index % 3 !== 0,
        createdAt: planned,
      });
    }

    // Top up the admin's leave balance usage to match the approved requests.
    const annualBalance = await ctx.db
      .query("leaveBalances")
      .withIndex("byEmployee", (q) => q.eq("employeeId", admin._id))
      .first();
    if (annualBalance) {
      await ctx.db.patch(annualBalance._id, {
        usedDays: annualBalance.usedDays + 3,
      });
    }

    await ctx.db.insert("auditLogs", {
      companyId: args.companyId,
      actorEmail: identity.email ?? "system",
      action: "company.seeded",
      detail: `${employees.length} employees`,
      at: now,
    });

    return {
      employees: employees.length,
      from: dateOnly(new Date(now - 30 * 86_400_000)),
      to: today,
      workDaysUsed: workDaysBetween(shiftDay(today, -30), today, company.workDays),
    };
  },
});
