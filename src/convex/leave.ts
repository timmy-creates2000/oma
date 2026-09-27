import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { LEAVE_STATUS } from "./schema";
import { addDaysKey, audit, dayKey, dayKeyToDate, isWorkDay, notify, requirePerm, requireWorkspace } from "./helpers";

/* --------------------------------- queries --------------------------------- */

export const leaveTypes = query({
  args: {},
  handler: async (ctx) => {
    const ws = await requireWorkspace(ctx);
    return await ctx.db.query("leaveTypes")
      .withIndex("by_company", (q) => q.eq("companyId", ws.company._id)).collect();
  },
});

export const myBalances = query({
  args: {},
  handler: async (ctx) => {
    const ws = await requireWorkspace(ctx);
    const year = new Date().getUTCFullYear();
    const types = await ctx.db.query("leaveTypes")
      .withIndex("by_company", (q) => q.eq("companyId", ws.company._id)).collect();
    const balances = await ctx.db.query("leaveBalances")
      .withIndex("by_company_year", (q) => q.eq("companyId", ws.company._id).eq("year", year))
      .filter((q) => q.eq(q.field("employeeId"), ws.employee._id))
      .collect();
    return types.map((t) => {
      const b = balances.find((x) => x.leaveTypeId === t._id);
      const used = b?.usedDays ?? 0;
      return { id: t._id, name: t.name, quota: t.annualQuotaDays, used, paid: t.paid };
    });
  },
});

export const myRequests = query({
  args: {},
  handler: async (ctx) => {
    const ws = await requireWorkspace(ctx);
    const rows = await ctx.db
      .query("leaveRequests")
      .withIndex("by_employee", (q) => q.eq("employeeId", ws.employee._id))
      .collect();
    const types = await ctx.db.query("leaveTypes")
      .withIndex("by_company", (q) => q.eq("companyId", ws.company._id)).collect();
    const tById = new Map(types.map((t) => [t._id, t]));
    return rows.sort((a, b) => b.createdAt - a.createdAt)
      .map((r) => ({ ...r, typeName: tById.get(r.leaveTypeId)?.name ?? "Leave" }));
  },
});

export const allRequests = query({
  args: { status: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const ws = await requireWorkspace(ctx);
    const rows = args.status
      ? await ctx.db.query("leaveRequests")
          .withIndex("by_company_status", (q) => q.eq("companyId", ws.company._id).eq("status", args.status as any))
          .collect()
      : await ctx.db.query("leaveRequests")
          .withIndex("by_company_status", (q) => q.eq("companyId", ws.company._id)).collect();
    const employees = await ctx.db.query("employees")
      .withIndex("by_company", (q) => q.eq("companyId", ws.company._id)).collect();
    const types = await ctx.db.query("leaveTypes")
      .withIndex("by_company", (q) => q.eq("companyId", ws.company._id)).collect();
    const empById = new Map(employees.map((e) => [e._id, e]));
    const tById = new Map(types.map((t) => [t._id, t]));
    return rows.sort((a, b) => b.createdAt - a.createdAt)
      .map((r) => ({
        ...r,
        employee: empById.get(r.employeeId) ?? null,
        typeName: tById.get(r.leaveTypeId)?.name ?? "Leave",
      }));
  },
});

export const calendar = query({
  args: { month: v.string() }, // "YYYY-MM"
  handler: async (ctx, args) => {
    const ws = await requireWorkspace(ctx);
    const rows = await ctx.db.query("leaveRequests")
      .withIndex("by_company_status", (q) => q.eq("companyId", ws.company._id))
      .collect();
    const employees = await ctx.db.query("employees")
      .withIndex("by_company", (q) => q.eq("companyId", ws.company._id)).collect();
    const empById = new Map(employees.map((e) => [e._id, e.name]));
    const prefix = args.month;
    return rows
      .filter((r) => r.startDate.startsWith(prefix) || r.endDate.startsWith(prefix) || (r.startDate <= prefix + "-31" && r.endDate >= prefix + "-01"))
      .map((r) => ({
        id: r._id,
        employeeName: empById.get(r.employeeId) ?? "Unknown",
        start: r.startDate,
        end: r.endDate,
        status: r.status,
      }));
  },
});

/* -------------------------------- mutations -------------------------------- */

export const request = mutation({
  args: {
    leaveTypeId: v.id("leaveTypes"),
    startDate: v.string(),
    endDate: v.string(),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const ws = await requireWorkspace(ctx);
    if (args.endDate < args.startDate) throw new Error("End date must be on or after start date.");
    if (!args.reason.trim()) throw new Error("A reason is required.");

    // overlap protection: no pending/approved leave overlapping these dates
    const existing = await ctx.db
      .query("leaveRequests")
      .withIndex("by_employee", (q) => q.eq("employeeId", ws.employee._id))
      .collect();
    const overlap = existing.some(
      (r) =>
        (r.status === LEAVE_STATUS.PENDING || r.status === LEAVE_STATUS.APPROVED) &&
        r.startDate <= args.endDate &&
        args.startDate <= r.endDate,
    );
    if (overlap) throw new Error("You already have a request overlapping these dates.");

    // balance check
    const year = dayKeyToDate(args.startDate).getUTCFullYear();
    const bal = await ctx.db
      .query("leaveBalances")
      .withIndex("by_employee_type", (q) => q.eq("employeeId", ws.employee._id).eq("leaveTypeId", args.leaveTypeId))
      .first();
    const type = await ctx.db.get(args.leaveTypeId);
    if (type && bal) {
      const requested = workDaysBetween(args.startDate, args.endDate, ws.company.workingHours);
      if (bal.usedDays + requested > type.annualQuotaDays) {
        throw new Error(`Insufficient balance: only ${Math.max(0, type.annualQuotaDays - bal.usedDays)} day(s) left of ${type.name}.`);
      }
    }

    await ctx.db.insert("leaveRequests", {
      companyId: ws.company._id,
      employeeId: ws.employee._id,
      leaveTypeId: args.leaveTypeId,
      startDate: args.startDate,
      endDate: args.endDate,
      reason: args.reason.trim(),
      status: LEAVE_STATUS.PENDING,
      createdAt: Date.now(),
    });
    await notify(ctx, {
      companyId: ws.company._id, audience: "admins", type: "leave_pending",
      title: "New leave request",
      body: `${ws.employee.name} requested ${args.startDate} → ${args.endDate}.`,
    });
    await audit(ctx, ws, "leave.requested", `${ws.employee.email} ${args.startDate}→${args.endDate}`);
    return { ok: true };
  },
});

export const decide = mutation({
  args: { id: v.id("leaveRequests"), approve: v.boolean(), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const ws = await requireWorkspace(ctx);
    requirePerm(ws, "approve_leave");
    const req = await ctx.db.get(args.id);
    if (!req || req.companyId !== ws.company._id) throw new Error("Request not found");
    if (req.status !== LEAVE_STATUS.PENDING) throw new Error("Already decided");

    await ctx.db.patch(args.id, {
      status: args.approve ? LEAVE_STATUS.APPROVED : LEAVE_STATUS.REJECTED,
      decidedBy: ws.user.email ?? ws.user.name,
      decidedAt: Date.now(),
      decisionNote: args.note,
    });

    if (args.approve) {
      const days = workDaysBetween(req.startDate, req.endDate, ws.company.workingHours);
      const bal = await ctx.db
        .query("leaveBalances")
        .withIndex("by_employee_type", (q) => q.eq("employeeId", req.employeeId).eq("leaveTypeId", req.leaveTypeId))
        .first();
      if (bal) {
        await ctx.db.patch(bal._id, { usedDays: bal.usedDays + days });
      } else {
        await ctx.db.insert("leaveBalances", {
          companyId: ws.company._id, employeeId: req.employeeId,
          leaveTypeId: req.leaveTypeId, year: dayKeyToDate(req.startDate).getUTCFullYear(),
          usedDays: days,
        });
      }
    }

    const emp = await ctx.db.get(req.employeeId);
    await notify(ctx, {
      companyId: ws.company._id, audience: "employee",
      forUserId: emp?.userId,
      type: args.approve ? "leave_approved" : "leave_rejected",
      title: args.approve ? "Leave approved" : "Leave rejected",
      body: `Your leave ${req.startDate} → ${req.endDate} was ${args.approve ? "approved" : "rejected"}${args.note ? `: ${args.note}` : "."}`,
    });
    await audit(ctx, ws, args.approve ? "leave.approved" : "leave.rejected", `request ${args.id}`);
    return { ok: true };
  },
});

export const cancel = mutation({
  args: { id: v.id("leaveRequests") },
  handler: async (ctx, args) => {
    const ws = await requireWorkspace(ctx);
    const req = await ctx.db.get(args.id);
    if (!req || req.employeeId !== ws.employee._id) throw new Error("Request not found");
    if (req.status !== LEAVE_STATUS.PENDING) throw new Error("Only pending requests can be cancelled.");
    await ctx.db.patch(args.id, { status: LEAVE_STATUS.CANCELLED });
    await audit(ctx, ws, "leave.cancelled", `request ${args.id}`);
    return { ok: true };
  },
});

/* --------------------------------- helpers --------------------------------- */

function workDaysBetween(
  startDk: string,
  endDk: string,
  wh: { workDays: readonly number[] },
): number {
  let count = 0;
  let cur = startDk;
  let guard = 0;
  while (cur <= endDk && guard < 400) {
    if (isWorkDay(wh, cur)) count += 1;
    cur = addDaysKey(cur, 1);
    guard += 1;
  }
  return Math.max(1, count);
}
