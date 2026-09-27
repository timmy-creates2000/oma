import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import {
  audit,
  dayKey,
  isAdmin,
  notifyAdmins,
  notifyEmployee,
  requireEmployee,
  requirePerm,
  workDaysBetween,
  yearOf,
} from "./helpers";

/** My requests plus the admin inbox, with leave types and balances attached. */
export const listLeave = query({
  args: {},
  handler: async (ctx) => {
    const employee = await requireEmployee(ctx);
    const company = await ctx.db.get(employee.companyId);
    if (!company) throw new Error("Company not found");

    const types = await ctx.db
      .query("leaveTypes")
      .withIndex("byCompany", (q) => q.eq("companyId", employee.companyId))
      .collect();
    const typeById = new Map(types.map((t) => [t._id, t]));

    const mine = await ctx.db
      .query("leaveRequests")
      .withIndex("byEmployee", (q) => q.eq("employeeId", employee._id))
      .collect();
    const all = isAdmin(employee.role)
      ? await ctx.db
          .query("leaveRequests")
          .withIndex("byCompanyStatus", (q) =>
            q.eq("companyId", employee.companyId).eq("status", "pending"),
          )
          .collect()
      : [];

    const balances = await ctx.db
      .query("leaveBalances")
      .withIndex("byEmployee", (q) => q.eq("employeeId", employee._id))
      .collect();

    const nameByEmployee = new Map<string, string>();
    for (const request of all) {
      if (nameByEmployee.has(request.employeeId)) continue;
      const owner = await ctx.db.get(request.employeeId);
      if (owner) nameByEmployee.set(request.employeeId, owner.name);
    }

    const decorate = (request: Doc<"leaveRequests">) => ({
      ...request,
      leaveTypeName: typeById.get(request.leaveTypeId)?.name ?? "Leave",
      paid: typeById.get(request.leaveTypeId)?.paid ?? true,
      employeeName: nameByEmployee.get(request.employeeId) ?? "Employee",
      days: workDaysBetween(
        request.startDate,
        request.endDate,
        company.workDays,
      ),
    });

    return {
      types,
      requests: mine
        .map(decorate)
        .sort((a, b) => b.createdAt - a.createdAt),
      inbox: all.map(decorate).sort((a, b) => a.startDate.localeCompare(b.startDate)),
      balances: types.map((type) => {
        const balance = balances.find(
          (b) => b.leaveTypeId === type._id && b.year === yearOf(dayKey(Date.now())),
        );
        return {
          leaveTypeId: type._id,
          name: type.name,
          paid: type.paid,
          quota: type.annualQuotaDays,
          used: balance?.usedDays ?? 0,
          remaining: type.annualQuotaDays - (balance?.usedDays ?? 0),
        };
      }),
    };
  },
});

export const requestLeave = mutation({
  args: {
    leaveTypeId: v.id("leaveTypes"),
    startDate: v.string(),
    endDate: v.string(),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const employee = await requireEmployee(ctx);
    const company = await ctx.db.get(employee.companyId);
    if (!company) throw new Error("Company not found");
    if (args.endDate < args.startDate) {
      throw new Error("The end date cannot be before the start date");
    }

    const type = await ctx.db.get(args.leaveTypeId);
    if (!type || type.companyId !== employee.companyId) {
      throw new Error("That leave type is not available");
    }

    const days = workDaysBetween(args.startDate, args.endDate, company.workDays);
    if (days < 1) throw new Error("That range contains no working days");

    const overlapping = await ctx.db
      .query("leaveRequests")
      .withIndex("byEmployee", (q) => q.eq("employeeId", employee._id))
      .collect();
    const clash = overlapping.find(
      (r) =>
        (r.status === "pending" || r.status === "approved") &&
        !(args.endDate < r.startDate || args.startDate > r.endDate),
    );
    if (clash) {
      throw new Error("You already have leave covering those dates");
    }

    const now = Date.now();
    const requestId = await ctx.db.insert("leaveRequests", {
      companyId: employee.companyId,
      employeeId: employee._id,
      leaveTypeId: args.leaveTypeId,
      startDate: args.startDate,
      endDate: args.endDate,
      reason: args.reason,
      status: "pending",
      createdAt: now,
    });

    await notifyAdmins(
      ctx,
      employee.companyId,
      "leave",
      "New leave request",
      `${employee.name} requested ${days} day${days === 1 ? "" : "s"} of ${type.name}.`,
    );
    await audit(ctx, employee.companyId, "leave.requested", `${args.startDate} → ${args.endDate}`);

    return { requestId, days };
  },
});

export const decideLeave = mutation({
  args: {
    requestId: v.id("leaveRequests"),
    approve: v.boolean(),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const admin = await requirePerm(ctx, "approve_leave");
    const request = await ctx.db.get(args.requestId);
    if (!request || request.companyId !== admin.companyId) {
      throw new Error("That request does not belong to your company");
    }
    if (request.status !== "pending") {
      throw new Error("That request has already been decided");
    }

    const company = await ctx.db.get(admin.companyId);
    if (!company) throw new Error("Company not found");
    const now = Date.now();
    const days = workDaysBetween(
      request.startDate,
      request.endDate,
      company.workDays,
    );

    await ctx.db.patch(request._id, {
      status: args.approve ? "approved" : "rejected",
      decidedBy: admin.email,
      decidedAt: now,
      decisionNote: args.note,
    });

    const balance = await ctx.db
      .query("leaveBalances")
      .withIndex("byEmployeeTypeYear", (q) =>
        q
          .eq("employeeId", request.employeeId)
          .eq("leaveTypeId", request.leaveTypeId)
          .eq("year", yearOf(request.startDate)),
      )
      .first();
    if (balance) {
      await ctx.db.patch(balance._id, {
        usedDays: Math.max(0, balance.usedDays + (args.approve ? days : 0)),
      });
    }

    const owner = await ctx.db.get(request.employeeId);
    if (owner) {
      await notifyEmployee(
        ctx,
        admin.companyId,
        owner,
        "leave",
        args.approve ? "Leave approved" : "Leave declined",
        args.approve
          ? `${days} day${days === 1 ? "" : "s"} approved for ${request.startDate}.`
          : `Your request for ${request.startDate} was declined.${args.note ? ` Note: ${args.note}` : ""}`,
      );
    }
    await audit(
      ctx,
      admin.companyId,
      args.approve ? "leave.approved" : "leave.rejected",
      `${request.startDate} → ${request.endDate}`,
    );

    return { ok: true, days };
  },
});

export const cancelLeave = mutation({
  args: { requestId: v.id("leaveRequests") },
  handler: async (ctx, args) => {
    const employee = await requireEmployee(ctx);
    const request = await ctx.db.get(args.requestId);
    if (!request || request.employeeId !== employee._id) {
      throw new Error("That request is not yours");
    }
    if (request.status === "cancelled") return { ok: true };
    if (request.status === "rejected") {
      throw new Error("A declined request cannot be cancelled");
    }

    const company = await ctx.db.get(employee.companyId);
    if (!company) throw new Error("Company not found");

    await ctx.db.patch(request._id, {
      status: "cancelled",
      decidedBy: employee.email,
      decidedAt: Date.now(),
    });

    if (request.status === "approved") {
      const days = workDaysBetween(
        request.startDate,
        request.endDate,
        company.workDays,
      );
      const balance = await ctx.db
        .query("leaveBalances")
        .withIndex("byEmployeeTypeYear", (q) =>
          q
            .eq("employeeId", request.employeeId)
            .eq("leaveTypeId", request.leaveTypeId)
            .eq("year", yearOf(request.startDate)),
        )
        .first();
      if (balance) {
        await ctx.db.patch(balance._id, {
          usedDays: Math.max(0, balance.usedDays - days),
        });
      }
    }

    await notifyAdmins(
      ctx,
      employee.companyId,
      "leave",
      "Leave cancelled",
      `${employee.name} cancelled leave from ${request.startDate}.`,
    );
    await audit(ctx, employee.companyId, "leave.cancelled", request.startDate);

    return { ok: true };
  },
});
