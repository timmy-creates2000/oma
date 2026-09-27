import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import {
  audit,
  atMinute,
  isAdmin,
  minutesOfDay,
  notifyAdmins,
  notifyEmployee,
  requireEmployee,
  requirePerm,
} from "./helpers";

/** My correction requests plus the admin review queue. */
export const listCorrections = query({
  args: {},
  handler: async (ctx) => {
    const employee = await requireEmployee(ctx);

    const mine = await ctx.db
      .query("correctionRequests")
      .withIndex("byEmployee", (q) => q.eq("employeeId", employee._id))
      .collect();
    const queue = isAdmin(employee.role)
      ? await ctx.db
          .query("correctionRequests")
          .withIndex("byCompanyStatus", (q) =>
            q.eq("companyId", employee.companyId).eq("status", "pending"),
          )
          .collect()
      : [];

    const nameByEmployee = new Map<string, string>();
    for (const request of [...mine, ...queue]) {
      if (nameByEmployee.has(request.employeeId)) continue;
      const owner = await ctx.db.get(request.employeeId);
      if (owner) nameByEmployee.set(request.employeeId, owner.name);
    }

    const decorate = (request: Doc<"correctionRequests">) => ({
      ...request,
      employeeName: nameByEmployee.get(request.employeeId) ?? "Employee",
    });

    return {
      requests: mine.map(decorate).sort((a, b) => b.createdAt - a.createdAt),
      queue: queue.map(decorate).sort((a, b) => a.sessionDate.localeCompare(b.sessionDate)),
    };
  },
});

export const requestCorrection = mutation({
  args: {
    sessionDate: v.string(),
    requestedClockInAt: v.optional(v.number()),
    requestedClockOutAt: v.optional(v.number()),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const employee = await requireEmployee(ctx);
    if (args.requestedClockInAt === undefined && args.requestedClockOutAt === undefined) {
      throw new Error("Give at least a corrected clock-in or clock-out time");
    }
    if (
      args.requestedClockInAt !== undefined &&
      args.requestedClockOutAt !== undefined &&
      args.requestedClockOutAt < args.requestedClockInAt
    ) {
      throw new Error("The clock-out time cannot be before the clock-in time");
    }

    const session = await ctx.db
      .query("attendanceSessions")
      .withIndex("byEmployeeDay", (q) =>
        q.eq("employeeId", employee._id).eq("dayKey", args.sessionDate),
      )
      .first();
    if (!session) {
      throw new Error("There is no attendance record for that day");
    }

    const pending = await ctx.db
      .query("correctionRequests")
      .withIndex("byEmployee", (q) => q.eq("employeeId", employee._id))
      .collect();
    if (pending.some((c) => c.sessionDate === args.sessionDate && c.status === "pending")) {
      throw new Error("You already have a correction waiting for that day");
    }

    const now = Date.now();
    const requestId = await ctx.db.insert("correctionRequests", {
      companyId: employee.companyId,
      employeeId: employee._id,
      sessionDate: args.sessionDate,
      requestedClockInAt: args.requestedClockInAt,
      requestedClockOutAt: args.requestedClockOutAt,
      reason: args.reason,
      status: "pending",
      createdAt: now,
    });

    await notifyAdmins(
      ctx,
      employee.companyId,
      "correction",
      "Correction requested",
      `${employee.name} asked to correct ${args.sessionDate}.`,
    );
    await audit(ctx, employee.companyId, "correction.requested", args.sessionDate);

    return { requestId };
  },
});

/** Approving rewrites the stored session and recomputes the derived minutes. */
export const decideCorrection = mutation({
  args: {
    requestId: v.id("correctionRequests"),
    approve: v.boolean(),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const admin = await requirePerm(ctx, "approve_corrections");
    const request = await ctx.db.get(args.requestId);
    if (!request || request.companyId !== admin.companyId) {
      throw new Error("That request does not belong to your company");
    }
    if (request.status !== "pending") {
      throw new Error("That request has already been reviewed");
    }

    const now = Date.now();
    await ctx.db.patch(request._id, {
      status: args.approve ? "approved" : "rejected",
      reviewerNote: args.note,
      reviewedBy: admin.email,
      reviewedAt: now,
    });

    if (args.approve) {
      const company = await ctx.db.get(admin.companyId);
      if (company) {
        const session = await ctx.db
          .query("attendanceSessions")
          .withIndex("byEmployeeDay", (q) =>
            q.eq("employeeId", request.employeeId).eq("dayKey", request.sessionDate),
          )
          .first();

        if (session) {
          const clockInAt =
            request.requestedClockInAt ?? session.clockInAt;
          const clockOutAt =
            request.requestedClockOutAt ?? session.clockOutAt;
          const scheduled = company.endMinute - company.startMinute;
          const workedMinutes =
            clockOutAt !== undefined
              ? Math.max(
                  0,
                  Math.round((clockOutAt - clockInAt) / 60_000) - session.breakMinutes,
                )
              : session.workedMinutes;
          const lateMinutes = Math.max(
            0,
            minutesOfDay(clockInAt) - company.startMinute - company.lateGraceMinutes,
          );
          const earlyLeaveMinutes =
            clockOutAt !== undefined
              ? Math.max(0, minutesOfDay(clockOutAt) - company.endMinute)
              : session.earlyLeaveMinutes;

          await ctx.db.patch(session._id, {
            clockInAt,
            clockOutAt,
            lateMinutes,
            earlyLeaveMinutes,
            workedMinutes,
            status:
              workedMinutes !== undefined && workedMinutes < scheduled / 2
                ? ("half_day" as const)
                : lateMinutes > 0
                  ? ("late" as const)
                  : ("present" as const),
            overtimeMinutes:
              workedMinutes !== undefined
                ? Math.max(0, workedMinutes - scheduled)
                : session.overtimeMinutes,
          });

          await ctx.db.insert("attendanceEvents", {
            companyId: admin.companyId,
            employeeId: request.employeeId,
            sessionId: session._id,
            kind: "auto_clock_out",
            at: now,
            dayKey: request.sessionDate,
          });
        }
      }
    }

    const owner = await ctx.db.get(request.employeeId);
    if (owner) {
      await notifyEmployee(
        ctx,
        admin.companyId,
        owner,
        "correction",
        args.approve ? "Correction approved" : "Correction declined",
        args.approve
          ? `Your attendance for ${request.sessionDate} was corrected.`
          : `Your correction for ${request.sessionDate} was declined.${args.note ? ` Note: ${args.note}` : ""}`,
      );
    }
    await audit(
      ctx,
      admin.companyId,
      args.approve ? "correction.approved" : "correction.rejected",
      request.sessionDate,
    );

    return { ok: true };
  },
});

/** Suggests the correction window for a day, used to prefill the request form. */
export const correctionContext = query({
  args: { sessionDate: v.string() },
  handler: async (ctx, args) => {
    const employee = await requireEmployee(ctx);
    const company = await ctx.db.get(employee.companyId);
    if (!company) throw new Error("Company not found");

    const session = await ctx.db
      .query("attendanceSessions")
      .withIndex("byEmployeeDay", (q) =>
        q.eq("employeeId", employee._id).eq("dayKey", args.sessionDate),
      )
      .first();

    return {
      session: session ?? null,
      startMinute: company.startMinute,
      endMinute: company.endMinute,
      suggestedClockInAt: session?.clockInAt ?? atMinute(args.sessionDate, company.startMinute),
      lateGraceMinutes: company.lateGraceMinutes,
    };
  },
});
