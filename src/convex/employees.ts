import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { APP_ROLES, appRoleValidator } from "./schema";
import { audit, requirePerm, requireWorkspace } from "./helpers";

/* --------------------------------- queries --------------------------------- */

export const list = query({
  args: { includeInactive: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const ws = await requireWorkspace(ctx);
    const rows = await ctx.db
      .query("employees")
      .withIndex("by_company", (q) => q.eq("companyId", ws.company._id))
      .collect();
    const filtered = args.includeInactive
      ? rows
      : rows.filter((r) => r.active && !r.deletedAt);
    const departments = await ctx.db.query("departments")
      .withIndex("by_company", (q) => q.eq("companyId", ws.company._id)).collect();
    const branches = await ctx.db.query("branches")
      .withIndex("by_company", (q) => q.eq("companyId", ws.company._id)).collect();
    const deptById = new Map(departments.map((d) => [d._id, d]));
    const brById = new Map(branches.map((b) => [b._id, b]));
    return filtered
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((e) => ({
        ...e,
        department: e.departmentId ? deptById.get(e.departmentId)?.name ?? null : null,
        branch: e.branchId ? brById.get(e.branchId)?.name ?? null : null,
      }));
  },
});

export const detail = query({
  args: { id: v.id("employees") },
  handler: async (ctx, args) => {
    const ws = await requireWorkspace(ctx);
    const emp = await ctx.db.get(args.id);
    if (!emp || emp.companyId !== ws.company._id) throw new Error("Not found");
    const dept = emp.departmentId ? await ctx.db.get(emp.departmentId) : null;
    const branch = emp.branchId ? await ctx.db.get(emp.branchId) : null;
    const devices = await ctx.db.query("registeredDevices")
      .withIndex("by_employee", (q) => q.eq("employeeId", emp._id)).collect();
    const sessions = await ctx.db.query("attendanceSessions")
      .withIndex("by_employee_recent", (q) => q.eq("employeeId", emp._id))
      .order("desc").take(30);
    const balances = await ctx.db.query("leaveBalances")
      .withIndex("by_company_year", (q) => q.eq("companyId", ws.company._id).eq("year", new Date().getUTCFullYear()))
      .filter((q) => q.eq(q.field("employeeId"), emp._id)).collect();
    const leaveTypes = await ctx.db.query("leaveTypes")
      .withIndex("by_company", (q) => q.eq("companyId", ws.company._id)).collect();
    const ltById = new Map(leaveTypes.map((t) => [t._id, t]));
    return {
      employee: emp,
      department: dept?.name ?? null,
      branch: branch?.name ?? null,
      devices,
      recentSessions: sessions,
      balances: balances.map((b) => ({
        id: b._id,
        typeName: ltById.get(b.leaveTypeId)?.name ?? "Leave",
        quota: ltById.get(b.leaveTypeId)?.annualQuotaDays ?? 0,
        used: b.usedDays,
      })),
    };
  },
});

/* -------------------------------- mutations -------------------------------- */

export const add = mutation({
  args: {
    name: v.string(),
    email: v.string(),
    employeeCode: v.string(),
    role: appRoleValidator,
    position: v.optional(v.string()),
    departmentId: v.optional(v.id("departments")),
    branchId: v.optional(v.id("branches")),
    managerEmail: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ws = await requireWorkspace(ctx);
    requirePerm(ws, "manage_employees");
    const email = args.email.trim().toLowerCase();
    const existing = await ctx.db
      .query("employees")
      .withIndex("by_company_email", (q) => q.eq("companyId", ws.company._id).eq("email", email))
      .first();
    if (existing) throw new Error("An employee with this email already exists.");
    const id = await ctx.db.insert("employees", {
      companyId: ws.company._id,
      email,
      name: args.name.trim(),
      employeeCode: args.employeeCode.trim().toUpperCase(),
      role: args.role,
      position: args.position,
      departmentId: args.departmentId,
      branchId: args.branchId,
      managerEmail: args.managerEmail,
      active: true,
      joinedAt: Date.now(),
    });
    await audit(ctx, ws, "employee.added", `${email} (${args.employeeCode})`);
    return { id };
  },
});

export const update = mutation({
  args: {
    id: v.id("employees"),
    name: v.optional(v.string()),
    position: v.optional(v.string()),
    role: v.optional(appRoleValidator),
    departmentId: v.optional(v.id("departments")),
    branchId: v.optional(v.id("branches")),
  },
  handler: async (ctx, args) => {
    const ws = await requireWorkspace(ctx);
    requirePerm(ws, "manage_employees");
    const emp = await ctx.db.get(args.id);
    if (!emp || emp.companyId !== ws.company._id) throw new Error("Not found");
    const patch: Record<string, unknown> = {};
    if (args.name !== undefined) patch.name = args.name;
    if (args.position !== undefined) patch.position = args.position;
    if (args.role !== undefined) patch.role = args.role;
    if (args.departmentId !== undefined) patch.departmentId = args.departmentId;
    if (args.branchId !== undefined) patch.branchId = args.branchId;
    await ctx.db.patch(args.id, patch);
    await audit(ctx, ws, "employee.updated", emp.email);
    return { ok: true };
  },
});

export const softDelete = mutation({
  args: { id: v.id("employees") },
  handler: async (ctx, args) => {
    const ws = await requireWorkspace(ctx);
    requirePerm(ws, "manage_employees");
    const emp = await ctx.db.get(args.id);
    if (!emp || emp.companyId !== ws.company._id) throw new Error("Not found");
    if (emp._id === ws.employee._id) throw new Error("You cannot deactivate yourself.");
    await ctx.db.patch(args.id, { active: false, deletedAt: Date.now() });
    await audit(ctx, ws, "employee.deactivated", emp.email);
    return { ok: true };
  },
});

/* ------------------------- departments & branches --------------------------- */

export const addDepartment = mutation({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    const ws = await requireWorkspace(ctx);
    requirePerm(ws, "manage_employees");
    const id = await ctx.db.insert("departments", { companyId: ws.company._id, name: args.name.trim() });
    await audit(ctx, ws, "department.added", args.name);
    return { id };
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
    const ws = await requireWorkspace(ctx);
    requirePerm(ws, "manage_company");
    const id = await ctx.db.insert("branches", {
      companyId: ws.company._id,
      name: args.name.trim(),
      address: args.address,
      latitude: args.latitude,
      longitude: args.longitude,
      geofenceRadiusM: args.geofenceRadiusM,
    });
    await audit(ctx, ws, "branch.added", args.name);
    return { id };
  },
});

export const listDepartments = query({
  args: {},
  handler: async (ctx) => {
    const ws = await requireWorkspace(ctx);
    return await ctx.db.query("departments")
      .withIndex("by_company", (q) => q.eq("companyId", ws.company._id)).collect();
  },
});

export const listBranches = query({
  args: {},
  handler: async (ctx) => {
    const ws = await requireWorkspace(ctx);
    return await ctx.db.query("branches")
      .withIndex("by_company", (q) => q.eq("companyId", ws.company._id)).collect();
  },
});

export const usage = query({
  args: {},
  handler: async (ctx) => {
    const ws = await requireWorkspace(ctx);
    const employees = await ctx.db.query("employees")
      .withIndex("by_company", (q) => q.eq("companyId", ws.company._id)).collect();
    const active = employees.filter((e) => e.active && !e.deletedAt);
    const devices = await ctx.db.query("registeredDevices")
      .withIndex("by_company", (q) => q.eq("companyId", ws.company._id)).collect();
    const displays = await ctx.db.query("qrDisplays")
      .withIndex("by_company", (q) => q.eq("companyId", ws.company._id)).collect();
    return {
      seats: active.length,
      devices: devices.filter((d) => d.status === "active").length,
      displays: displays.filter((d) => d.active).length,
      storageMb: 0,
    };
  },
});
