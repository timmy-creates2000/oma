import { query } from "./_generated/server";
import { v } from "convex/values";
import { ATTENDANCE_STATUS } from "./schema";
import { addDaysKey, dayKey, isWorkDay, requireWorkspace } from "./helpers";

/* ------------------------------- dashboard ---------------------------------- */

export const dashboard = query({
  args: {},
  handler: async (ctx) => {
    const ws = await requireWorkspaceSilent(ctx);
    if (!ws) return null;
    const { company, employee } = ws;
    const dk = dayKey(Date.now());
    const employees = await activeEmployeesOf(ctx, company._id);
    const sessions = await ctx.db
      .query("attendanceSessions")
      .withIndex("by_company_day", (q) => q.eq("companyId", company._id).eq("dayKey", dk))
      .collect();
    const active = employees.filter((e) => e.active && !e.deletedAt);
    const live = sessions.filter((s) => !s.deletedAt);
    const counts = {
      totalEmployees: active.length,
      present: live.filter((s) => s.status === ATTENDANCE_STATUS.PRESENT).length,
      late: live.filter((s) => s.status === ATTENDANCE_STATUS.LATE).length,
      onLeave: live.filter((s) => s.status === ATTENDANCE_STATUS.ON_LEAVE).length,
      halfDay: live.filter((s) => s.status === ATTENDANCE_STATUS.HALF_DAY).length,
      ongoing: live.filter((s) => !s.clockOutAt && s.status !== ATTENDANCE_STATUS.ON_LEAVE).length,
    };
    const withSession = live.filter((s) => s.status !== ATTENDANCE_STATUS.ON_LEAVE).length;
    const absent = Math.max(0, active.length - withSession - counts.onLeave);
    // missing clock-outs (yesterday and before, last 7 days)
    let missingOut = 0;
    for (let d = 1; d <= 7; d++) {
      const past = await ctx.db
        .query("attendanceSessions")
        .withIndex("by_company_day", (q) => q.eq("companyId", company._id).eq("dayKey", addDaysKey(dk, -d)))
        .collect();
      missingOut += past.filter((s) => !s.deletedAt && !s.clockOutAt && s.status !== ATTENDANCE_STATUS.ON_LEAVE).length;
    }

    // 14-day trend
    const trend: Array<{ day: string; present: number; late: number; absent: number }> = [];
    for (let d = 13; d >= 0; d--) {
      const day = addDaysKey(dk, -d);
      const daySessions = d === 0
        ? live
        : await ctx.db
            .query("attendanceSessions")
            .withIndex("by_company_day", (q) => q.eq("companyId", company._id).eq("dayKey", day))
            .collect();
      const rows = daySessions.filter((s) => !s.deletedAt);
      const worked = rows.filter((s) => s.status !== ATTENDANCE_STATUS.ON_LEAVE);
      trend.push({
        day,
        present: worked.filter((s) => s.status === ATTENDANCE_STATUS.PRESENT || s.status === ATTENDANCE_STATUS.ONGOING).length,
        late: worked.filter((s) => s.status === ATTENDANCE_STATUS.LATE).length,
        absent: Math.max(0, active.length - worked.length - rows.filter((s) => s.status === ATTENDANCE_STATUS.ON_LEAVE).length),
      });
    }

    // department breakdown (today)
    const departments = await ctx.db.query("departments")
      .withIndex("by_company", (q) => q.eq("companyId", company._id)).collect();
    const empById = new Map(active.map((e) => [e._id, e]));
    const deptRows = departments.map((dep) => {
      const emps = active.filter((e) => e.departmentId === dep._id);
      const sess = live.filter((s) => empById.get(s.employeeId)?.departmentId === dep._id);
      const worked = sess.filter((s) => s.status !== ATTENDANCE_STATUS.ON_LEAVE);
      return {
        name: dep.name,
        total: emps.length,
        present: worked.filter((s) => s.status !== ATTENDANCE_STATUS.LATE).length,
        late: worked.filter((s) => s.status === ATTENDANCE_STATUS.LATE).length,
        absent: Math.max(0, emps.length - worked.length),
      };
    });

    // recent events
    const events = await ctx.db
      .query("attendanceEvents")
      .withIndex("by_company", (q) => q.eq("companyId", company._id))
      .order("desc")
      .take(12);
    const eventsEnriched = await Promise.all(events.map(async (ev) => {
      const emp = empById.get(ev.employeeId);
      return { ...ev, employeeName: emp?.name ?? "Unknown" };
    }));

    const upcoming = await ctx.db.query("leaveRequests")
      .withIndex("by_company_status", (q) => q.eq("companyId", company._id).eq("status", "pending" as any))
      .collect();

    return {
      counts: { ...counts, absent, missingOut },
      trend,
      deptRows,
      recentEvents: eventsEnriched,
      pendingLeave: upcoming.filter((r) => {
        const emp = empById.get(r.employeeId);
        return !!emp;
      }).length,
      pendingCorrections: await ctx.db.query("correctionRequests")
        .withIndex("by_company_status", (q) => q.eq("companyId", company._id).eq("status", "pending" as any))
        .collect().then((rows) => rows.filter((r) => empById.has(r.employeeId)).length),
      myRole: employee.role,
    };
  },
});

/* --------------------------------- analytics -------------------------------- */

export const range = query({
  args: {
    from: v.string(),
    to: v.string(),
    departmentId: v.optional(v.id("departments")),
    branchId: v.optional(v.id("branches")),
    employeeId: v.optional(v.id("employees")),
  },
  handler: async (ctx, args) => {
    const ws = await requireWorkspaceSilent(ctx);
    if (!ws) return null;
    const { company } = ws;
    const employees = await activeEmployeesOf(ctx, company._id);
    const empById = new Map(employees.map((e) => [e._id, e]));
    const scoped = employees.filter((e) =>
      (!args.departmentId || e.departmentId === args.departmentId) &&
      (!args.branchId || e.branchId === args.branchId) &&
      (!args.employeeId || e._id === args.employeeId),
    );
    const scopedIds = new Set(scoped.map((e) => e._id));

    // iterate days (guard against huge ranges)
    const from = args.from;
    const to = args.to;
    const dayList: string[] = [];
    let cur = from;
    let guard = 0;
    while (cur <= to && guard < 400) {
      dayList.push(cur);
      cur = addDaysKey(cur, 1);
      guard += 1;
    }

    const allSessions: any[] = [];
    for (const d of dayList) {
      const rows = await ctx.db
        .query("attendanceSessions")
        .withIndex("by_company_day", (q) => q.eq("companyId", company._id).eq("dayKey", d))
        .collect();
      allSessions.push(...rows.filter((s) => !s.deletedAt && scopedIds.has(s.employeeId)));
    }

    const worked = allSessions.filter((s) => s.status !== ATTENDANCE_STATUS.ON_LEAVE);
    const closed = worked.filter((s) => s.clockOutAt);
    const scheduled = Math.max(1, company.workingHours.endMinutes - company.workingHours.startMinutes);

    const totalWorkedMin = closed.reduce((acc, s) => acc + (s.workedMinutes ?? 0), 0);
    const lateSessions = worked.filter((s) => s.status === ATTENDANCE_STATUS.LATE);
    const holidays = await ctx.db.query("publicHolidays")
      .withIndex("by_company_date", (q) => q.eq("companyId", company._id)).collect();
    const holidaySet = new Set(holidays.map((h) => h.date));

    // expected work days in range per employee (approx: shared workDays)
    let expectedDays = 0;
    for (const d of dayList) {
      if (!isWorkDay(company.workingHours, d) || holidaySet.has(d)) continue;
      expectedDays += scoped.length;
    }
    const leaveDays = allSessions.filter((s) => s.status === ATTENDANCE_STATUS.ON_LEAVE).length;

    // per-employee rows for reports
    const perEmployee = scoped.map((e) => {
      const mine = worked.filter((s) => s.employeeId === e._id);
      const mineClosed = mine.filter((s) => s.clockOutAt);
      const late = mine.filter((s) => s.status === ATTENDANCE_STATUS.LATE);
      const dept = e.departmentId ? empById.get(e._id)?.departmentId : null;
      return {
        employeeId: e._id,
        name: e.name,
        code: e.employeeCode,
        department: dept ?? "—",
        presentDays: mineClosed.filter((s) => s.status === ATTENDANCE_STATUS.PRESENT).length,
        lateDays: late.length,
        halfDays: mine.filter((s) => s.status === ATTENDANCE_STATUS.HALF_DAY).length,
        absentDays: Math.max(0, expectedDays / Math.max(1, scoped.length) - mine.length),
        leaveDays: allSessions.filter((s) => s.employeeId === e._id && s.status === ATTENDANCE_STATUS.ON_LEAVE).length,
        workedHours: Math.round(mineClosed.reduce((acc, s) => acc + (s.workedMinutes ?? 0), 0) / 6) / 10,
        overtimeHours: Math.round((mineClosed.reduce((acc, s) => acc + s.overtimeMinutes, 0) / 60) * 10) / 10,
        lateMinutes: late.reduce((acc, s) => acc + s.lateMinutes, 0),
      };
    });

    const avgArrival = closed.length
      ? closed.reduce((acc, s) => {
          const d = new Date(s.clockInAt);
          return acc + d.getUTCHours() * 60 + d.getUTCMinutes();
        }, 0) / closed.length
      : 0;
    const avgDeparture = closed.length
      ? closed.reduce((acc, s) => {
          const d = new Date(s.clockOutAt!);
          return acc + d.getUTCHours() * 60 + d.getUTCMinutes();
        }, 0) / closed.length
      : 0;

    const m = Math.round(avgArrival);
    const m2 = Math.round(avgDeparture);

    return {
      totals: {
        employeeCount: scoped.length,
        attendanceRate: expectedDays > 0 ? Math.round((worked.length / expectedDays) * 1000) / 10 : 0,
        punctualityRate: worked.length > 0 ? Math.round(((worked.length - lateSessions.length) / worked.length) * 1000) / 10 : 0,
        avgArrival: `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`,
        avgDeparture: `${String(Math.floor(m2 / 60)).padStart(2, "0")}:${String(m2 % 60).padStart(2, "0")}`,
        avgWorkedHours: closed.length ? Math.round((totalWorkedMin / closed.length / 6) / 10) : 0,
        totalLateMinutes: lateSessions.reduce((acc, s) => acc + s.lateMinutes, 0),
        totalOvertimeHours: Math.round((worked.reduce((acc, s) => acc + s.overtimeMinutes, 0) / 60) * 10) / 10,
        earlyDepartures: worked.filter((s) => s.earlyLeaveMinutes > 15).length,
        absenceDays: Math.max(0, expectedDays - worked.length - leaveDays),
        leaveDays,
      },
      perEmployee,
      daily: dayList.map((d) => {
        const rows = allSessions.filter((s) => s.dayKey === d);
        const w = rows.filter((s) => s.status !== ATTENDANCE_STATUS.ON_LEAVE);
        return {
          day: d,
          present: w.filter((s) => s.status === ATTENDANCE_STATUS.PRESENT || s.status === ATTENDANCE_STATUS.ONGOING).length,
          late: w.filter((s) => s.status === ATTENDANCE_STATUS.LATE).length,
          absent: Math.max(0,
            scoped.length - w.length - rows.filter((s) => s.status === ATTENDANCE_STATUS.ON_LEAVE).length),
        };
      }),
    };
  },
});

/* --------------------------------- helpers ---------------------------------- */

async function requireWorkspaceSilent(ctx: any) {
  try {
    return await requireWorkspace(ctx);
  } catch {
    return null;
  }
}

async function activeEmployeesOf(ctx: any, companyId: string): Promise<any[]> {
  return await ctx.db
    .query("employees")
    .withIndex("by_company", (q: any) => q.eq("companyId", companyId))
    .filter((q: any) => q.eq(q.field("active"), true))
    .collect();
}
