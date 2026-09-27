import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import {
  audit,
  companySettings,
  dayKey,
  notifyAdmins,
  requireEmployee,
  requirePerm,
  workDaysBetween,
  yearOf,
} from "./helpers";

/** The employee directory, with today's attendance state folded in. */
export const listEmployees = query({
  args: {
    search: v.optional(v.string()),
    includeInactive: v.optional(v.boolean()),
    departmentId: v.optional(v.id("departments")),
  },
  handler: async (ctx, args) => {
    await requirePerm(ctx, "manage_employees");
    const companyId = (await requireEmployee(ctx)).companyId;
    const today = dayKey(Date.now());

    const all = await ctx.db
      .query("employees")
      .withIndex("byCompany", (q) => q.eq("companyId", companyId))
      .collect();
    const departments = await ctx.db
      .query("departments")
      .withIndex("byCompany", (q) => q.eq("companyId", companyId))
      .collect();
    const branches = await ctx.db
      .query("branches")
      .withIndex("byCompany", (q) => q.eq("companyId", companyId))
      .collect();
    const departmentName = new Map(departments.map((d) => [d._id, d.name]));
    const branchName = new Map(branches.map((b) => [b._id, b.name]));

    const sessions = await ctx.db
      .query("attendanceSessions")
      .withIndex("byCompanyDay", (q) => q.eq("companyId", companyId).eq("dayKey", today))
      .collect();
    const sessionByEmployee = new Map(sessions.map((s) => [s.employeeId, s]));

    const devices = await ctx.db
      .query("registeredDevices")
      .withIndex("byCompany", (q) => q.eq("companyId", companyId))
      .collect();

    const search = args.search?.trim().toLowerCase();
    return all
      .filter((e) => (args.includeInactive ? true : e.active))
      .filter((e) => (args.departmentId ? e.departmentId === args.departmentId : true))
      .filter((e) =>
        search
          ? e.name.toLowerCase().includes(search) ||
            e.email.toLowerCase().includes(search) ||
            e.employeeCode.toLowerCase().includes(search)
          : true,
      )
      .map((e) => {
        const device = devices.find((d) => d.employeeId === e._id);
        const session = sessionByEmployee.get(e._id);
        return {
          ...e,
          departmentName: e.departmentId ? departmentName.get(e.departmentId) : undefined,
          branchName: e.branchId ? branchName.get(e.branchId) : undefined,
          deviceStatus: device?.status ?? "none",
          todayStatus: session?.status ?? "absent",
          todayClockInAt: session?.clockInAt,
          todayLateMinutes: session?.lateMinutes ?? 0,
        };
      })
      .sort((a, b) => a.employeeCode.localeCompare(b.employeeCode));
  },
});

/** Everything the employee drawer shows: profile, recent days, leave, devices. */
export const employeeDetail = query({
  args: { employeeId: v.id("employees") },
  handler: async (ctx, args) => {
    await requirePerm(ctx, "view_reports");
    const employee = await ctx.db.get(args.employeeId);
    if (!employee) throw new Error("Employee not found");

    const company = await ctx.db.get(employee.companyId);
    if (!company) throw new Error("Company not found");

    const today = dayKey(Date.now());
    const sessions = await ctx.db
      .query("attendanceSessions")
      .withIndex("byEmployeeDay", (q) => q.eq("employeeId", employee._id))
      .collect();
    const recent = sessions
      .filter((s) => s.dayKey >= dayKey(Date.now() - 30 * 86_400_000) && s.dayKey <= today)
      .sort((a, b) => b.dayKey.localeCompare(a.dayKey))
      .slice(0, 30);

    const leaveRequests = await ctx.db
      .query("leaveRequests")
      .withIndex("byEmployee", (q) => q.eq("employeeId", employee._id))
      .collect();
    const types = await ctx.db
      .query("leaveTypes")
      .withIndex("byCompany", (q) => q.eq("companyId", employee.companyId))
      .collect();
    const balances = await ctx.db
      .query("leaveBalances")
      .withIndex("byEmployee", (q) => q.eq("employeeId", employee._id))
      .collect();
    const devices = await ctx.db
      .query("registeredDevices")
      .withIndex("byEmployee", (q) => q.eq("employeeId", employee._id))
      .collect();

    const worked = recent.reduce((sum, s) => sum + (s.workedMinutes ?? 0), 0);
    const late = recent.reduce((sum, s) => sum + s.lateMinutes, 0);

    return {
      employee,
      recent,
      summary: {
        days: recent.length,
        workedMinutes: worked,
        averageMinutes: recent.length ? Math.round(worked / recent.length) : 0,
        lateMinutes: late,
        lateDays: recent.filter((s) => s.lateMinutes > 0).length,
        overtimeMinutes: recent.reduce((sum, s) => sum + s.overtimeMinutes, 0),
        absentDays: recent.filter((s) => s.status === "absent").length,
      },
      leaveRequests: leaveRequests
        .map((r) => ({
          ...r,
          leaveTypeName: types.find((t) => t._id === r.leaveTypeId)?.name ?? "Leave",
          days: workDaysBetween(r.startDate, r.endDate, company.workDays),
        }))
        .sort((a, b) => b.createdAt - a.createdAt),
      balances: types.map((t) => {
        const balance = balances.find(
          (b) => b.leaveTypeId === t._id && b.year === yearOf(today),
        );
        return {
          name: t.name,
          quota: t.annualQuotaDays,
          used: balance?.usedDays ?? 0,
          remaining: t.annualQuotaDays - (balance?.usedDays ?? 0),
        };
      }),
      devices,
    };
  },
});

export const addEmployee = mutation({
  args: {
    email: v.string(),
    name: v.string(),
    role: v.union(
      v.literal("company_admin"),
      v.literal("hr_admin"),
      v.literal("manager"),
      v.literal("employee"),
    ),
    departmentId: v.optional(v.id("departments")),
    branchId: v.optional(v.id("branches")),
    position: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const admin = await requirePerm(ctx, "manage_employees");
    const email = args.email.trim().toLowerCase();
    if (!email.includes("@")) throw new Error("Enter a valid email address");

    const existing = await ctx.db
      .query("employees")
      .withIndex("byCompany", (q) => q.eq("companyId", admin.companyId))
      .filter((q) => q.eq(q.field("email"), email))
      .first();
    if (existing) throw new Error("That email is already in the directory");

    const everyone = await ctx.db
      .query("employees")
      .withIndex("byCompany", (q) => q.eq("companyId", admin.companyId))
      .collect();

    const now = Date.now();
    const employeeId = await ctx.db.insert("employees", {
      companyId: admin.companyId,
      email,
      name: args.name.trim(),
      employeeCode: `EMP-${String(everyone.length + 1).padStart(3, "0")}`,
      role: args.role,
      departmentId: args.departmentId,
      branchId: args.branchId,
      position: args.position,
      joinedAt: now,
      active: true,
    });

    const types = await ctx.db
      .query("leaveTypes")
      .withIndex("byCompany", (q) => q.eq("companyId", admin.companyId))
      .collect();
    for (const type of types) {
      await ctx.db.insert("leaveBalances", {
        companyId: admin.companyId,
        employeeId,
        leaveTypeId: type._id,
        year: new Date(now).getUTCFullYear(),
        usedDays: 0,
      });
    }

    await audit(ctx, admin.companyId, "employee.added", `${args.name} <${email}>`);
    return { employeeId };
  },
});

export const deactivateEmployee = mutation({
  args: { employeeId: v.id("employees") },
  handler: async (ctx, args) => {
    const admin = await requirePerm(ctx, "manage_employees");
    const employee = await ctx.db.get(args.employeeId);
    if (!employee || employee.companyId !== admin.companyId) {
      throw new Error("That employee is not in your company");
    }
    if (employee._id === admin._id) {
      throw new Error("You cannot deactivate your own account");
    }

    const now = Date.now();
    await ctx.db.patch(employee._id, { active: false, deletedAt: now });

    const devices = await ctx.db
      .query("registeredDevices")
      .withIndex("byEmployee", (q) => q.eq("employeeId", employee._id))
      .collect();
    for (const device of devices) {
      if (device.status === "revoked") continue;
      await ctx.db.patch(device._id, { status: "revoked", revokedAt: now });
      await ctx.db.insert("deviceEvents", {
        companyId: admin.companyId,
        deviceId: device._id,
        employeeId: employee._id,
        type: "revoked",
        detail: "Employee deactivated",
        actor: admin.email,
        at: now,
      });
    }

    await audit(ctx, admin.companyId, "employee.deactivated", employee.email);
    return { ok: true };
  },
});

export const addDepartment = mutation({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    const admin = await requirePerm(ctx, "manage_employees");
    const departmentId = await ctx.db.insert("departments", {
      companyId: admin.companyId,
      name: args.name.trim(),
    });
    await audit(ctx, admin.companyId, "department.added", args.name);
    return { departmentId };
  },
});

export const addBranch = mutation({
  args: {
    name: v.string(),
    address: v.optional(v.string()),
    latitude: v.optional(v.number()),
    longitude: v.optional(v.number()),
    geofenceRadiusM: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const admin = await requirePerm(ctx, "manage_employees");
    const branchId = await ctx.db.insert("branches", {
      companyId: admin.companyId,
      name: args.name.trim(),
      address: args.address,
      latitude: args.latitude,
      longitude: args.longitude,
      geofenceRadiusM: args.geofenceRadiusM ?? 250,
    });
    await audit(ctx, admin.companyId, "branch.added", args.name);
    return { branchId };
  },
});

export const updateSettings = mutation({
  args: {
    startMinute: v.number(),
    endMinute: v.number(),
    lateGraceMinutes: v.number(),
    workDays: v.array(v.number()),
    geoEnabled: v.boolean(),
    qrRotationSeconds: v.optional(v.number()),
    requireGeo: v.optional(v.boolean()),
    autoClockOutHours: v.optional(v.number()),
    retentionDays: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const admin = await requirePerm(ctx, "manage_settings");
    if (args.endMinute <= args.startMinute) {
      throw new Error("The workday must end after it starts");
    }
    if (args.workDays.length === 0) {
      throw new Error("Pick at least one working day");
    }

    const company = await ctx.db.get(admin.companyId);
    if (!company) throw new Error("Company not found");
    await ctx.db.patch(admin.companyId, {
      startMinute: args.startMinute,
      endMinute: args.endMinute,
      lateGraceMinutes: args.lateGraceMinutes,
      workDays: args.workDays,
      geoEnabled: args.geoEnabled,
    });

    const settings = await companySettings(ctx, admin.companyId);
    if (settings) {
      await ctx.db.patch(settings._id, {
        qrRotationSeconds: args.qrRotationSeconds ?? settings.qrRotationSeconds,
        requireGeo: args.requireGeo ?? settings.requireGeo,
        autoClockOutHours: args.autoClockOutHours ?? settings.autoClockOutHours,
        retentionDays: args.retentionDays ?? settings.retentionDays,
      });
    }

    await audit(ctx, admin.companyId, "settings.updated");
    return { ok: true };
  },
});

export const addHoliday = mutation({
  args: { date: v.string(), name: v.string() },
  handler: async (ctx, args) => {
    const admin = await requirePerm(ctx, "manage_settings");
    const holidayId = await ctx.db.insert("publicHolidays", {
      companyId: admin.companyId,
      date: args.date,
      name: args.name.trim(),
    });
    await audit(ctx, admin.companyId, "holiday.added", `${args.date} ${args.name}`);
    return { holidayId };
  },
});

export const removeHoliday = mutation({
  args: { holidayId: v.id("publicHolidays") },
  handler: async (ctx, args) => {
    const admin = await requirePerm(ctx, "manage_settings");
    const holiday = await ctx.db.get(args.holidayId);
    if (!holiday || holiday.companyId !== admin.companyId) {
      throw new Error("That holiday is not in your company");
    }
    await ctx.db.delete(args.holidayId);
    await audit(ctx, admin.companyId, "holiday.removed", holiday.date);
    return { ok: true };
  },
});

export const addLeaveType = mutation({
  args: {
    name: v.string(),
    annualQuotaDays: v.number(),
    paid: v.boolean(),
  },
  handler: async (ctx, args) => {
    const admin = await requirePerm(ctx, "manage_leave");
    const leaveTypeId = await ctx.db.insert("leaveTypes", {
      companyId: admin.companyId,
      name: args.name.trim(),
      annualQuotaDays: args.annualQuotaDays,
      paid: args.paid,
    });

    const everyone = await ctx.db
      .query("employees")
      .withIndex("byCompany", (q) => q.eq("companyId", admin.companyId))
      .collect();
    const year = new Date().getUTCFullYear();
    for (const person of everyone) {
      await ctx.db.insert("leaveBalances", {
        companyId: admin.companyId,
        employeeId: person._id,
        leaveTypeId,
        year,
        usedDays: 0,
      });
    }

    await audit(ctx, admin.companyId, "leave_type.added", args.name);
    return { leaveTypeId };
  },
});

export const listQrDisplays = query({
  args: {},
  handler: async (ctx) => {
    const employee = await requireEmployee(ctx);
    const displays = await ctx.db
      .query("qrDisplays")
      .withIndex("byCompany", (q) => q.eq("companyId", employee.companyId))
      .collect();
    const branches = await ctx.db
      .query("branches")
      .withIndex("byCompany", (q) => q.eq("companyId", employee.companyId))
      .collect();
    const branchName = new Map(branches.map((b) => [b._id, b.name]));

    const result = [];
    for (const display of displays) {
      // qrTokens has no company index, so walk each display's own token stream.
      const tokens = await ctx.db
        .query("qrTokens")
        .withIndex("byDisplay", (q) => q.eq("displayId", display._id))
        .collect();
      const live = tokens.find(
        (t) => t.consumedAt === undefined && t.expiresAt > Date.now(),
      );
      result.push({
        ...display,
        branchName: display.branchId ? branchName.get(display.branchId) : undefined,
        activeToken: live ? { expiresAt: live.expiresAt, issuedAt: live.issuedAt } : null,
        scanCount: tokens.filter((t) => t.consumedAt !== undefined).length,
      });
    }

    return result.sort((a, b) => b.createdAt - a.createdAt);
  },
});

export const createQrDisplay = mutation({
  args: { label: v.string(), branchId: v.optional(v.id("branches")) },
  handler: async (ctx, args) => {
    const admin = await requirePerm(ctx, "manage_qr");
    const displayId = await ctx.db.insert("qrDisplays", {
      companyId: admin.companyId,
      branchId: args.branchId,
      label: args.label.trim(),
      active: true,
      createdAt: Date.now(),
    });
    await audit(ctx, admin.companyId, "qr_display.created", args.label);
    return { displayId };
  },
});

export const toggleQrDisplay = mutation({
  args: { displayId: v.id("qrDisplays") },
  handler: async (ctx, args) => {
    const admin = await requirePerm(ctx, "manage_qr");
    const display = await ctx.db.get(args.displayId);
    if (!display || display.companyId !== admin.companyId) {
      throw new Error("That QR display is not in your company");
    }
    await ctx.db.patch(display._id, { active: !display.active });
    await audit(
      ctx,
      admin.companyId,
      display.active ? "qr_display.disabled" : "qr_display.enabled",
      display.label,
    );
    return { ok: true, active: !display.active };
  },
});

export const deleteQrDisplay = mutation({
  args: { displayId: v.id("qrDisplays") },
  handler: async (ctx, args) => {
    const admin = await requirePerm(ctx, "manage_qr");
    const display = await ctx.db.get(args.displayId);
    if (!display || display.companyId !== admin.companyId) {
      throw new Error("That QR display is not in your company");
    }
    const tokens = await ctx.db
      .query("qrTokens")
      .withIndex("byDisplay", (q) => q.eq("displayId", display._id))
      .collect();
    for (const token of tokens) {
      await ctx.db.delete(token._id);
    }
    await ctx.db.delete(display._id);
    await audit(ctx, admin.companyId, "qr_display.deleted", display.label);
    return { ok: true };
  },
});

/** Settings page payload: schedule, holidays, leave types and QR displays. */
export const orgSettings = query({
  args: {},
  handler: async (ctx) => {
    const employee = await requireEmployee(ctx);
    const company = await ctx.db.get(employee.companyId);
    if (!company) throw new Error("Company not found");

    const [settings, holidays, leaveTypes, branches, departments] =
      await Promise.all([
        companySettings(ctx, employee.companyId),
        ctx.db
          .query("publicHolidays")
          .withIndex("byCompanyDate", (q) => q.eq("companyId", employee.companyId))
          .collect(),
        ctx.db
          .query("leaveTypes")
          .withIndex("byCompany", (q) => q.eq("companyId", employee.companyId))
          .collect(),
        ctx.db
          .query("branches")
          .withIndex("byCompany", (q) => q.eq("companyId", employee.companyId))
          .collect(),
        ctx.db
          .query("departments")
          .withIndex("byCompany", (q) => q.eq("companyId", employee.companyId))
          .collect(),
      ]);

    const people = await ctx.db
      .query("employees")
      .withIndex("byCompany", (q) => q.eq("companyId", employee.companyId))
      .collect();

    return {
      company,
      settings,
      holidays: holidays.sort((a, b) => a.date.localeCompare(b.date)),
      leaveTypes,
      branches,
      departments,
      headcount: people.filter((p) => p.active).length,
      teams: departments.map((d) => ({
        id: d._id,
        name: d.name,
        headcount: people.filter(
          (p) => p.active && p.departmentId === (d._id as Id<"departments">),
        ).length,
      })),
    };
  },
});

export const notifyHeadcountChanged = mutation({
  args: {},
  handler: async (ctx) => {
    const admin = await requireEmployee(ctx);
    const people = await ctx.db
      .query("employees")
      .withIndex("byCompany", (q) => q.eq("companyId", admin.companyId))
      .collect();
    await notifyAdmins(
      ctx,
      admin.companyId,
      "people",
      "Headcount updated",
      `${people.filter((p) => p.active).length} active people.`,
    );
    return { ok: true };
  },
});
