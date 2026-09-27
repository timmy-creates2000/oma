import { v } from "convex/values";
import { query } from "./_generated/server";
import {
  can,
  dayKey,
  isAdmin,
  requireEmployee,
  shiftDay,
} from "./helpers";

const MS_PER_DAY = 86_400_000;

function statusCounts(sessions: { status: string }[]) {
  const counts: Record<string, number> = {
    present: 0,
    late: 0,
    half_day: 0,
    ongoing: 0,
    holiday: 0,
    weekend: 0,
    on_leave: 0,
    absent: 0,
  };
  for (const session of sessions) {
    counts[session.status] = (counts[session.status] ?? 0) + 1;
  }
  return counts;
}

/** First screen: today's pulse, my own day, and what needs a decision. */
export const dashboardData = query({
  args: {},
  handler: async (ctx) => {
    const employee = await requireEmployee(ctx);
    const company = await ctx.db.get(employee.companyId);
    if (!company) throw new Error("Company not found");
    const today = dayKey(Date.now());

    const people = await ctx.db
      .query("employees")
      .withIndex("byCompany", (q) => q.eq("companyId", employee.companyId))
      .collect();
    const active = people.filter((p) => p.active);

    const sessions = await ctx.db
      .query("attendanceSessions")
      .withIndex("byCompanyDay", (q) =>
        q.eq("companyId", employee.companyId).eq("dayKey", today),
      )
      .collect();
    const byEmployee = new Map(sessions.map((s) => [s.employeeId, s]));
    const counts = statusCounts(sessions);

    const departments = await ctx.db
      .query("departments")
      .withIndex("byCompany", (q) => q.eq("companyId", employee.companyId))
      .collect();
    const deptRows = departments.map((d) => {
      const members = active.filter((p) => p.departmentId === d._id);
      const memberSessions = members
        .map((m) => byEmployee.get(m._id))
        .filter((s): s is NonNullable<typeof s> => s !== undefined);
      const deptCounts = statusCounts(memberSessions);
      return {
        name: d.name,
        total: members.length,
        present: deptCounts.present + deptCounts.half_day + deptCounts.ongoing,
        late: deptCounts.late,
        absent: Math.max(0, members.length - memberSessions.length),
      };
    });

    const nameById = new Map(people.map((p) => [p._id, p]));
    const mySession = byEmployee.get(employee._id) ?? null;

    const recentEvents = await ctx.db
      .query("attendanceEvents")
      .withIndex("byCompany", (q) => q.eq("companyId", employee.companyId))
      .collect();
    const activity = recentEvents
      .sort((a, b) => b.at - a.at)
      .slice(0, 12)
      .map((event) => {
        const person = nameById.get(event.employeeId);
        return {
          id: event._id,
          kind: event.kind,
          at: event.at,
          name: person?.name ?? "Someone",
          employeeCode: person?.employeeCode ?? "",
        };
      });

    // Seven-day trend for the sparkline.
    const trend: { day: string; present: number; late: number; absent: number }[] = [];
    for (let back = 6; back >= 0; back--) {
      const day = shiftDay(today, -back);
      const daySessions = await ctx.db
        .query("attendanceSessions")
        .withIndex("byCompanyDay", (q) =>
          q.eq("companyId", employee.companyId).eq("dayKey", day),
        )
        .collect();
      const dayCounts = statusCounts(daySessions);
      trend.push({
        day,
        present: dayCounts.present + dayCounts.late + dayCounts.half_day,
        late: dayCounts.late,
        absent: dayCounts.absent,
      });
    }

    const admin = isAdmin(employee.role);
    const [pendingLeave, pendingCorrections, pendingDevices, unread] = admin
      ? await Promise.all([
          ctx.db
            .query("leaveRequests")
            .withIndex("byCompanyStatus", (q) =>
              q.eq("companyId", employee.companyId).eq("status", "pending"),
            )
            .collect(),
          ctx.db
            .query("correctionRequests")
            .withIndex("byCompanyStatus", (q) =>
              q.eq("companyId", employee.companyId).eq("status", "pending"),
            )
            .collect(),
          ctx.db
            .query("registeredDevices")
            .withIndex("byCompany", (q) => q.eq("companyId", employee.companyId))
            .collect(),
          ctx.db
            .query("notifications")
            .withIndex("byCompanyUnread", (q) =>
              q.eq("companyId", employee.companyId).eq("readAt", undefined),
            )
            .collect(),
        ])
      : [[], [], [], []];

    const devicesWithoutOne = admin
      ? active.filter(
          (p) =>
            !pendingDevices.some(
              (d) => d.employeeId === p._id && d.status !== "revoked",
            ),
        ).length
      : 0;

    return {
      today,
      companyName: company.name,
      headcount: active.length,
      todaySummary: {
        expected: active.length,
        present: counts.present + counts.late + counts.half_day + counts.ongoing,
        late: counts.late,
        ongoing: counts.ongoing,
        absent: Math.max(0, active.length - sessions.length),
        onLeave: counts.on_leave + counts.holiday,
      },
      me: mySession
        ? {
            status: mySession.status,
            clockInAt: mySession.clockInAt,
            clockOutAt: mySession.clockOutAt,
            lateMinutes: mySession.lateMinutes,
            workedMinutes: mySession.workedMinutes,
          }
        : null,
      trend,
      deptRows,
      activity,
      approvals: {
        isAdmin: admin,
        leave: admin ? pendingLeave.length : 0,
        corrections: admin ? pendingCorrections.length : 0,
        devices: admin
          ? pendingDevices.filter((d) => d.status === "pending_replacement").length
          : 0,
        peopleWithoutDevice: devicesWithoutOne,
      },
      canViewReports: can(employee.role, "view_reports"),
    };
  },
});

/** Who is physically in the office right now, plus the latest scans. */
export const liveAttendance = query({
  args: {},
  handler: async (ctx) => {
    const employee = await requireEmployee(ctx);
    if (!can(employee.role, "view_reports")) {
      throw new Error("You do not have permission to view live attendance");
    }
    const today = dayKey(Date.now());

    const [people, sessions, devices, events] = await Promise.all([
      ctx.db
        .query("employees")
        .withIndex("byCompany", (q) => q.eq("companyId", employee.companyId))
        .collect(),
      ctx.db
        .query("attendanceSessions")
        .withIndex("byCompanyDay", (q) =>
          q.eq("companyId", employee.companyId).eq("dayKey", today),
        )
        .collect(),
      ctx.db
        .query("registeredDevices")
        .withIndex("byCompany", (q) => q.eq("companyId", employee.companyId))
        .collect(),
      ctx.db
        .query("attendanceEvents")
        .withIndex("byCompany", (q) => q.eq("companyId", employee.companyId))
        .collect(),
    ]);

    const nameById = new Map(people.map((p) => [p._id, p]));
    const deviceLabel = new Map(devices.map((d) => [d._id, d.label]));

    const inside = sessions
      .filter((s) => s.clockOutAt === undefined && s.status === "ongoing")
      .map((s) => {
        const person = nameById.get(s.employeeId);
        return {
          sessionId: s._id,
          employeeId: s.employeeId,
          name: person?.name ?? "Unknown",
          employeeCode: person?.employeeCode ?? "",
          position: person?.position,
          clockInAt: s.clockInAt,
          lateMinutes: s.lateMinutes,
          device: s.clockInDeviceId ? deviceLabel.get(s.clockInDeviceId) : undefined,
          geoVerified: s.geoVerified,
        };
      })
      .sort((a, b) => a.clockInAt - b.clockInAt);

    const goneHome = sessions
      .filter((s) => s.clockOutAt !== undefined)
      .map((s) => {
        const person = nameById.get(s.employeeId);
        return {
          employeeId: s.employeeId,
          name: person?.name ?? "Unknown",
          clockInAt: s.clockInAt,
          clockOutAt: s.clockOutAt as number,
          status: s.status,
        };
      })
      .sort((a, b) => (b.clockOutAt as number) - (a.clockOutAt as number));

    const scans = events
      .filter((e) => e.dayKey === today)
      .sort((a, b) => b.at - a.at)
      .slice(0, 20)
      .map((e) => {
        const person = nameById.get(e.employeeId);
        return {
          id: e._id,
          kind: e.kind,
          at: e.at,
          name: person?.name ?? "Unknown",
          employeeCode: person?.employeeCode ?? "",
          geoVerified: e.geoVerified ?? false,
        };
      });

    return {
      today,
      inside,
      goneHome,
      scans,
      totals: {
        expected: people.filter((p) => p.active).length,
        inside: inside.length,
        goneHome: goneHome.length,
        notIn: Math.max(
          0,
          people.filter((p) => p.active).length - inside.length - goneHome.length,
        ),
      },
    };
  },
});

/** Aggregate analytics for any date range, plus per-person and per-team rows. */
export const analyticsRange = query({
  args: { from: v.string(), to: v.string() },
  handler: async (ctx, args) => {
    const employee = await requireEmployee(ctx);
    if (!can(employee.role, "view_reports")) {
      throw new Error("You do not have permission to view reports");
    }
    if (args.to < args.from) throw new Error("The end date cannot be before the start date");

    const company = await ctx.db.get(employee.companyId);
    if (!company) throw new Error("Company not found");

    const [people, departments, sessions] = await Promise.all([
      ctx.db
        .query("employees")
        .withIndex("byCompany", (q) => q.eq("companyId", employee.companyId))
        .collect(),
      ctx.db
        .query("departments")
        .withIndex("byCompany", (q) => q.eq("companyId", employee.companyId))
        .collect(),
      ctx.db
        .query("attendanceSessions")
        .withIndex("byCompanyDay", (q) =>
          q
            .eq("companyId", employee.companyId)
            .gte("dayKey", args.from)
            .lte("dayKey", args.to),
        )
        .collect(),
    ]);

    const active = people.filter((p) => p.active);
    const departmentName = new Map(departments.map((d) => [d._id, d.name]));
    const expectedDays = active.length * company.workDays.length;

    const byDay = new Map<string, typeof sessions>();
    for (const session of sessions) {
      const list = byDay.get(session.dayKey) ?? [];
      list.push(session);
      byDay.set(session.dayKey, list);
    }

    const daily = [...byDay.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([day, daySessions]) => {
        const counts = statusCounts(daySessions);
        const worked = daySessions.reduce((sum, s) => sum + (s.workedMinutes ?? 0), 0);
        return {
          day,
          present: counts.present + counts.late + counts.half_day,
          late: counts.late,
          absent: counts.absent,
          overtime: daySessions.reduce((sum, s) => sum + s.overtimeMinutes, 0),
          averageWorkedMinutes: daySessions.length
            ? Math.round(worked / daySessions.length)
            : 0,
        };
      });

    const totalWorked = sessions.reduce((sum, s) => sum + (s.workedMinutes ?? 0), 0);
    const counted = sessions.filter(
      (s) => s.status === "present" || s.status === "late" || s.status === "half_day",
    ).length;
    const lateDays = sessions.filter((s) => s.lateMinutes > 0).length;

    const rows = active
      .map((person) => {
        const mine = sessions.filter((s) => s.employeeId === person._id);
        const worked = mine.reduce((sum, s) => sum + (s.workedMinutes ?? 0), 0);
        const present = mine.filter(
          (s) =>
            s.status === "present" ||
            s.status === "late" ||
            s.status === "half_day" ||
            s.status === "ongoing",
        ).length;
        return {
          employeeId: person._id,
          name: person.name,
          employeeCode: person.employeeCode,
          departmentName: person.departmentId
            ? departmentName.get(person.departmentId)
            : "Unassigned",
          position: person.position,
          present,
          lateDays: mine.filter((s) => s.lateMinutes > 0).length,
          lateMinutes: mine.reduce((sum, s) => sum + s.lateMinutes, 0),
          workedMinutes: worked,
          averageMinutes: present ? Math.round(worked / present) : 0,
          overtimeMinutes: mine.reduce((sum, s) => sum + s.overtimeMinutes, 0),
          absentDays: Math.max(
            0,
            company.workDays.length * Math.max(1, Math.round((Date.parse(args.to) - Date.parse(args.from)) / MS_PER_DAY) + 1) - present,
          ),
        };
      })
      .sort((a, b) => b.workedMinutes - a.workedMinutes);

    const teams = departments.map((d) => {
      const members = rows.filter((r) => r.departmentName === d.name);
      const worked = members.reduce((sum, m) => sum + m.workedMinutes, 0);
      const present = members.reduce((sum, m) => sum + m.present, 0);
      return {
        departmentId: d._id,
        name: d.name,
        headcount: members.length,
        present,
        attendanceRate: members.length ? Math.round((present / members.length) * 100) : 0,
        averageMinutes: members.length ? Math.round(worked / members.length) : 0,
        lateDays: members.reduce((sum, m) => sum + m.lateDays, 0),
      };
    });

    return {
      from: args.from,
      to: args.to,
      totals: {
        headcount: active.length,
        records: sessions.length,
        attendanceRate: expectedDays
          ? Math.round((counted / expectedDays) * 100)
          : 0,
        averageWorkedMinutes: counted ? Math.round(totalWorked / counted) : 0,
        totalOvertimeMinutes: sessions.reduce((sum, s) => sum + s.overtimeMinutes, 0),
        lateDays,
        lateRate: counted ? Math.round((lateDays / counted) * 100) : 0,
        absentDays: sessions.filter((s) => s.status === "absent").length,
      },
      daily,
      rows,
      teams: teams.sort((a, b) => b.attendanceRate - a.attendanceRate),
    };
  },
});

/** Flat rows for CSV export, one line per employee per day. */
export const reportRows = query({
  args: { from: v.string(), to: v.string() },
  handler: async (ctx, args) => {
    const employee = await requireEmployee(ctx);
    if (!can(employee.role, "view_reports")) {
      throw new Error("You do not have permission to export reports");
    }

    const [people, sessions] = await Promise.all([
      ctx.db
        .query("employees")
        .withIndex("byCompany", (q) => q.eq("companyId", employee.companyId))
        .collect(),
      ctx.db
        .query("attendanceSessions")
        .withIndex("byCompanyDay", (q) =>
          q
            .eq("companyId", employee.companyId)
            .gte("dayKey", args.from)
            .lte("dayKey", args.to),
        )
        .collect(),
    ]);

    const nameById = new Map(people.map((p) => [p._id, p]));
    return sessions
      .map((s) => {
        const person = nameById.get(s.employeeId);
        return {
          date: s.dayKey,
          employeeCode: person?.employeeCode ?? "",
          name: person?.name ?? "",
          department: person?.position ?? "",
          clockInAt: s.clockInAt,
          clockOutAt: s.clockOutAt ?? "",
          workedMinutes: s.workedMinutes ?? 0,
          lateMinutes: s.lateMinutes,
          overtimeMinutes: s.overtimeMinutes,
          status: s.status,
        };
      })
      .sort((a, b) => a.date.localeCompare(b.date) || a.employeeCode.localeCompare(b.employeeCode));
  },
});

/** My own attendance history, used by the employee workspace view. */
export const myAttendance = query({
  args: { days: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const employee = await requireEmployee(ctx);
    const today = dayKey(Date.now());
    const from = shiftDay(today, -(args.days ?? 30));

    const sessions = await ctx.db
      .query("attendanceSessions")
      .withIndex("byEmployeeDay", (q) =>
        q.eq("employeeId", employee._id).gte("dayKey", from),
      )
      .collect();

    const worked = sessions.reduce((sum, s) => sum + (s.workedMinutes ?? 0), 0);
    return {
      from,
      to: today,
      sessions: sessions.sort((a, b) => b.dayKey.localeCompare(a.dayKey)),
      summary: {
        days: sessions.length,
        workedMinutes: worked,
        averageMinutes: sessions.length ? Math.round(worked / sessions.length) : 0,
        lateDays: sessions.filter((s) => s.lateMinutes > 0).length,
        overtimeMinutes: sessions.reduce((sum, s) => sum + s.overtimeMinutes, 0),
      },
    };
  },
});
