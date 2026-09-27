import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { audit, requirePerm, requireWorkspace } from "./helpers";

/* ------------------------------- notifications ------------------------------ */

export const myNotifications = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const ws = await requireWorkspace(ctx);
    const personal = await ctx.db
      .query("notifications")
      .withIndex("by_user", (q) => q.eq("forUserId", ws.user._id))
      .order("desc")
      .take(args.limit ?? 50);
    const adminFeed = ["company_admin", "hr_admin"].includes(ws.employee.role)
      ? await ctx.db
          .query("notifications")
          .withIndex("by_audience", (q) =>
            q.eq("companyId", ws.company._id).eq("audience", "admins"),
          )
          .order("desc")
          .take(args.limit ?? 50)
      : [];
    return [...personal, ...adminFeed]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, args.limit ?? 50);
  },
});

export const markRead = mutation({
  args: { id: v.id("notifications") },
  handler: async (ctx, args) => {
    const ws = await requireWorkspace(ctx);
    const n = await ctx.db.get(args.id);
    if (!n || n.companyId !== ws.company._id) throw new Error("Not found");
    await ctx.db.patch(args.id, { readAt: Date.now() });
    return { ok: true };
  },
});

export const markAllRead = mutation({
  args: {},
  handler: async (ctx) => {
    const ws = await requireWorkspace(ctx);
    const personal = await ctx.db
      .query("notifications")
      .withIndex("by_user", (q) => q.eq("forUserId", ws.user._id))
      .collect();
    const adminFeed = ["company_admin", "hr_admin"].includes(ws.employee.role)
      ? await ctx.db
          .query("notifications")
          .withIndex("by_audience", (q) =>
            q.eq("companyId", ws.company._id).eq("audience", "admins"),
          )
          .collect()
      : [];
    for (const n of [...personal, ...adminFeed]) {
      if (!n.readAt) await ctx.db.patch(n._id, { readAt: Date.now() });
    }
    return { ok: true };
  },
});

/* ---------------------------------- audit ----------------------------------- */

export const auditLogs = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const ws = await requireWorkspace(ctx);
    requirePerm(ws, "view_audit");
    return await ctx.db
      .query("auditLogs")
      .withIndex("by_company", (q) => q.eq("companyId", ws.company._id))
      .order("desc")
      .take(args.limit ?? 200);
  },
});

/* --------------------------------- settings --------------------------------- */

export const getSettings = query({
  args: {},
  handler: async (ctx) => {
    const ws = await requireWorkspace(ctx);
    return { company: ws.company, settings: ws.settings };
  },
});

export const updateSettings = mutation({
  args: {
    companyName: v.optional(v.string()),
    industry: v.optional(v.string()),
    startMinutes: v.optional(v.number()),
    endMinutes: v.optional(v.number()),
    lateGraceMinutes: v.optional(v.number()),
    workDays: v.optional(v.array(v.number())),
    qrRotationSeconds: v.optional(v.number()),
    requireGeo: v.optional(v.boolean()),
    geoVerification: v.optional(v.boolean()),
    autoClockOutHours: v.optional(v.number()),
    retentionDays: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const ws = await requireWorkspace(ctx);
    requirePerm(ws, "manage_settings");
    const companyPatch: Record<string, unknown> = {};
    if (args.companyName !== undefined) companyPatch.name = args.companyName;
    if (args.industry !== undefined) companyPatch.industry = args.industry;
    if (
      args.startMinutes !== undefined || args.endMinutes !== undefined ||
      args.lateGraceMinutes !== undefined || args.workDays !== undefined
    ) {
      companyPatch.workingHours = {
        startMinutes: args.startMinutes ?? ws.company.workingHours.startMinutes,
        endMinutes: args.endMinutes ?? ws.company.workingHours.endMinutes,
        lateGraceMinutes: args.lateGraceMinutes ?? ws.company.workingHours.lateGraceMinutes,
        workDays: args.workDays ?? ws.company.workingHours.workDays,
      };
    }
    if (args.geoVerification !== undefined) companyPatch.geoVerification = args.geoVerification;
    if (Object.keys(companyPatch).length > 0) {
      await ctx.db.patch(ws.company._id, companyPatch);
    }

    const settingsPatch: Record<string, unknown> = {};
    if (args.qrRotationSeconds !== undefined) settingsPatch.qrRotationSeconds = args.qrRotationSeconds;
    if (args.requireGeo !== undefined) settingsPatch.requireGeo = args.requireGeo;
    if (args.autoClockOutHours !== undefined) settingsPatch.autoClockOutHours = args.autoClockOutHours;
    if (args.retentionDays !== undefined) settingsPatch.retentionDays = args.retentionDays;
    if (Object.keys(settingsPatch).length > 0) {
      await ctx.db.patch(ws.settings._id, settingsPatch);
    }

    await audit(ctx, ws, "settings.updated", Object.keys({ ...companyPatch, ...settingsPatch }).join(", "));
    return { ok: true };
  },
});

/* ------------------------------- holidays ----------------------------------- */

export const listHolidays = query({
  args: {},
  handler: async (ctx) => {
    const ws = await requireWorkspace(ctx);
    const rows = await ctx.db.query("publicHolidays")
      .withIndex("by_company_date", (q) => q.eq("companyId", ws.company._id))
      .collect();
    return rows.sort((a, b) => a.date.localeCompare(b.date));
  },
});

export const addHoliday = mutation({
  args: { date: v.string(), name: v.string() },
  handler: async (ctx, args) => {
    const ws = await requireWorkspace(ctx);
    requirePerm(ws, "manage_settings");
    const id = await ctx.db.insert("publicHolidays", {
      companyId: ws.company._id, date: args.date, name: args.name.trim(),
    });
    await audit(ctx, ws, "holiday.added", `${args.date} ${args.name}`);
    return { id };
  },
});

export const removeHoliday = mutation({
  args: { id: v.id("publicHolidays") },
  handler: async (ctx, args) => {
    const ws = await requireWorkspace(ctx);
    requirePerm(ws, "manage_settings");
    const h = await ctx.db.get(args.id);
    if (!h || h.companyId !== ws.company._id) throw new Error("Not found");
    await ctx.db.delete(args.id);
    await audit(ctx, ws, "holiday.removed", `${h.date} ${h.name}`);
    return { ok: true };
  },
});

/* --------------------------- leave types (admin) ----------------------------- */

export const addLeaveType = mutation({
  args: { name: v.string(), annualQuotaDays: v.number(), paid: v.boolean() },
  handler: async (ctx, args) => {
    const ws = await requireWorkspace(ctx);
    requirePerm(ws, "manage_settings");
    const id = await ctx.db.insert("leaveTypes", {
      companyId: ws.company._id, name: args.name.trim(),
      annualQuotaDays: args.annualQuotaDays, paid: args.paid,
    });
    await audit(ctx, ws, "leave_type.added", args.name);
    return { id };
  },
});
