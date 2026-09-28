import { AppShell, hasPerm } from "@/components/AppShell";
import { GlassCard, StatTile, PageHeader } from "@/components/glass";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, BarChart, Bar,
} from "recharts";
import {
  Users, UserCheck, Clock3, TimerReset, CalendarOff, Plane,
  Building2, ArrowRight, LogIn, LogOut, AlertTriangle, Activity, ScanLine, Fingerprint,
} from "lucide-react";
import { useNavigate } from "react-router";
import { useEffect } from "react";
import { fmtTime, type DashboardData } from "@/lib/sb";
import { useWorkspace } from "@/hooks/use-workspace";
import { supabase, err } from "@/lib/sb";
import { useState } from "react";
import { toast } from "sonner";

const DAY_FMT = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });

function shiftDay(key: string, days: number) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

const tooltipStyle = {
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.6)",
  background: "rgba(255,255,255,0.88)",
  backdropFilter: "blur(12px)",
  fontSize: 12,
} as const;

export default function Dashboard() {
  const navigate = useNavigate();
  const { ws } = useWorkspace();
  const [dash, setDash] = useState<DashboardData | null>(null);
  const [today, setToday] = useState<{
    clock_in_at: string;
    clock_out_at: string | null;
    late_minutes: number;
    worked_minutes: number | null;
  } | null>(null);

  useEffect(() => {
    if (!ws) return;
    const workspace = ws;
    let cancelled = false;
    async function load() {
      const companyId = workspace.employee.company_id;
      const todayKey = new Date().toISOString().slice(0, 10);
      const [employees, sessions, events, leave, corrections, devices, departments] = await Promise.all([
        supabase.from("employees").select("id, name, employee_code, department_id").eq("company_id", companyId).eq("active", true),
        supabase.from("attendance_sessions").select("*").eq("company_id", companyId).gte("day_key", shiftDay(todayKey, -6)).lte("day_key", todayKey),
        supabase.from("attendance_events").select("id, kind, at, day_key, employee_id").eq("company_id", companyId).order("at", { ascending: false }).limit(12),
        supabase.from("leave_requests").select("id").eq("company_id", companyId).eq("status", "pending"),
        supabase.from("correction_requests").select("id").eq("company_id", companyId).eq("status", "pending"),
        supabase.from("registered_devices").select("employee_id").eq("company_id", companyId).eq("status", "active"),
        supabase.from("departments").select("id, name").eq("company_id", companyId),
      ]);
      const empRows = employees.data ?? [];
      const sessionRows = sessions.data ?? [];
      const todayRows = sessionRows.filter((s) => s.day_key === todayKey);
      const byEmployee = new Map(empRows.map((e) => [e.id, e]));
      const presentIds = new Set(todayRows.map((s) => s.employee_id));
      const deviceOwnerIds = new Set((devices.data ?? []).map((d) => d.employee_id));
      const eventRows = (events.data ?? []).map((event) => ({
        id: event.id,
        kind: event.kind,
        at: event.at,
        day_key: event.day_key,
        employee_name: byEmployee.get(event.employee_id)?.name ?? "Employee",
        employee_code: byEmployee.get(event.employee_id)?.employee_code ?? "",
      }));
      const trend = Array.from({ length: 7 }, (_, index) => {
        const day = shiftDay(todayKey, index - 6);
        const rows = sessionRows.filter((s) => s.day_key === day);
        return {
          day,
          present: rows.filter((s) => ["present", "late"].includes(s.status)).length,
          late: rows.filter((s) => s.status === "late").length,
          absent: Math.max(0, empRows.length - rows.length),
        };
      });
      const deptRows = (departments.data ?? []).map((dept) => {
        const members = empRows.filter((e) => e.department_id === dept.id);
        const rows = todayRows.filter((s) => members.some((m) => m.id === s.employee_id));
        return {
          name: dept.name,
          total: members.length,
          present: rows.filter((s) => ["present", "late"].includes(s.status)).length,
          late: rows.filter((s) => s.status === "late").length,
          absent: Math.max(0, members.length - rows.length),
        };
      });
      const session = todayRows.find((s) => s.employee_id === workspace.employee.id) ?? null;
      if (!cancelled) {
        setToday(session ? {
          clock_in_at: session.clock_in_at,
          clock_out_at: session.clock_out_at,
          late_minutes: session.late_minutes,
          worked_minutes: session.worked_minutes,
        } : null);
        setDash({
          counts: {
            total_employees: empRows.length,
            present: todayRows.filter((s) => ["present", "late"].includes(s.status)).length,
            late: todayRows.filter((s) => s.status === "late").length,
            half_day: todayRows.filter((s) => s.status === "half_day").length,
            on_leave: 0,
            ongoing: todayRows.filter((s) => !s.clock_out_at).length,
            absent: Math.max(0, empRows.length - presentIds.size),
            missing_out: todayRows.filter((s) => !s.clock_out_at).length,
            missing_devices: Math.max(0, empRows.length - deviceOwnerIds.size),
          },
          trend,
          deptRows,
          recentEvents: eventRows,
          pendingLeave: leave.data?.length ?? 0,
          pendingCorrections: corrections.data?.length ?? 0,
          myRole: workspace.employee.role,
        });
      }
    }
    load().catch((e) => toast.error(err(e)));
    return () => { cancelled = true; };
  }, [ws]);

  const myName = ws?.employee.name ?? "there";
  const mySession = today;
  const approvals = dash ? {
    leave: dash.pendingLeave,
    corrections: dash.pendingCorrections,
    devices: 0,
    peopleWithoutDevice: dash.counts.missing_devices,
  } : null;

  return (
    <AppShell title="Dashboard">
      <PageHeader
        title={`Good ${greeting()}, ${myName.split(" ")[0]}`}
        subtitle="Here's what's happening across your company today."
      />

      {!dash ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <GlassCard key={i} className="h-24 animate-pulse" />
          ))}
        </div>
      ) : (
        <>
          {/* my status card */}
          <GlassCard strong className="mb-6 p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground">Your attendance today</p>
                {mySession && !mySession.clock_out_at ? (
                  <p className="mt-1 text-lg font-semibold">
                    Clocked in at {fmtTime(mySession.clock_in_at)}
                    {mySession.late_minutes > 0 ? ` · ${mySession.late_minutes}m late` : " · on time"}
                  </p>
                ) : mySession ? (
                  <p className="mt-1 text-lg font-semibold">
                    Done for today — {((mySession.worked_minutes ?? 0) / 60).toFixed(1)}h worked
                  </p>
                ) : (
                  <p className="mt-1 text-lg font-semibold">Not clocked in yet — scan the office QR at the kiosk.</p>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => navigate("/kiosk")}>
                  <ScanLine className="size-4" /> Open kiosk
                </Button>
                <Button variant="outline" className="glass" onClick={() => navigate("/me")}>
                  My workspace <ArrowRight className="size-4" />
                </Button>
              </div>
            </div>
          </GlassCard>

          {/* stats */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile icon={Users} label="Total employees" value={dash.counts.total_employees} />
            <StatTile icon={UserCheck} label="Present today" value={dash.counts.present} tone="text-emerald-600" />
            <StatTile icon={Clock3} label="Late today" value={dash.counts.late} tone="text-amber-600" />
            <StatTile icon={TimerReset} label="Currently in office" value={dash.counts.ongoing} tone="text-sky-600" />
            <StatTile icon={Plane} label="On leave" value={dash.counts.on_leave} tone="text-violet-600" />
            <StatTile icon={CalendarOff} label="Absent / not arrived" value={dash.counts.absent} tone="text-rose-600" />
            <StatTile
              icon={Fingerprint}
              label="People without a device"
              value={approvals?.peopleWithoutDevice ?? 0}
              tone="text-orange-600"
            />
            <StatTile
              icon={Activity}
              label="Pending reviews"
              value={(approvals?.leave ?? 0) + (approvals?.corrections ?? 0)}
              hint={`${approvals?.leave ?? 0} leave · ${approvals?.corrections ?? 0} corrections`}
            />
          </div>

          {/* trend + dept */}
          <div className="mt-6 grid gap-4 lg:grid-cols-3">
            <GlassCard className="p-5 lg:col-span-2">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="font-semibold">Attendance trend — last 7 days</h3>
                <Badge variant="outline" className="glass-soft text-[10px]">live</Badge>
              </div>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={dash.trend.map((t) => ({ ...t, label: DAY_FMT(t.day) }))}>
                    <defs>
                      <linearGradient id="gPresent" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#6366f1" stopOpacity={0.5} />
                        <stop offset="100%" stopColor="#6366f1" stopOpacity={0.05} />
                      </linearGradient>
                      <linearGradient id="gLate" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.5} />
                        <stop offset="100%" stopColor="#f59e0b" stopOpacity={0.05} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(100,116,139,0.15)" vertical={false} />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} />
                    <YAxis tickLine={false} axisLine={false} fontSize={11} allowDecimals={false} width={28} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Area type="monotone" dataKey="present" stroke="#6366f1" fill="url(#gPresent)" strokeWidth={2.5} name="Present" />
                    <Area type="monotone" dataKey="late" stroke="#f59e0b" fill="url(#gLate)" strokeWidth={2} name="Late" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </GlassCard>

            <GlassCard className="p-5">
              <h3 className="mb-4 font-semibold">Departments today</h3>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dash.deptRows} layout="vertical" barSize={14}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(100,116,139,0.15)" horizontal={false} />
                    <XAxis type="number" hide />
                    <YAxis type="category" dataKey="name" width={90} tickLine={false} axisLine={false} fontSize={11} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Bar dataKey="present" stackId="a" fill="#10b981" name="Present" />
                    <Bar dataKey="late" stackId="a" fill="#f59e0b" name="Late" />
                    <Bar dataKey="absent" stackId="a" fill="#f43f5e" radius={[0, 4, 4, 0]} name="Absent" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </GlassCard>
          </div>

          {/* activity */}
          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <GlassCard className="p-5">
              <div className="mb-3 flex items-center gap-2">
                <LogIn className="size-4 text-primary" />
                <h3 className="font-semibold">Recent attendance activity</h3>
              </div>
              <div className="space-y-2">
                 {dash.recentEvents.length === 0 && (
                  <p className="py-6 text-center text-sm text-muted-foreground">No activity yet.</p>
                )}
                {dash.recentEvents.map((ev) => (
                  <div key={ev.id} className="glass-soft flex items-center justify-between rounded-xl px-3.5 py-2.5">
                    <div className="flex items-center gap-2.5">
                      {ev.kind === "clock_out" ? (
                        <LogOut className="size-3.5 text-rose-500" />
                      ) : (
                        <LogIn className="size-3.5 text-emerald-500" />
                      )}
                      <div>
                         <p className="text-sm font-medium">{ev.employee_name}</p>
                        <p className="text-[11px] text-muted-foreground">
                           {ev.kind === "clock_out" ? "Clocked out" : ev.kind === "clock_in" ? "Clocked in" : "Auto clock-out"} · {fmtTime(ev.at)}
                        </p>
                      </div>
                    </div>
                     <span className="text-[11px] text-muted-foreground">{ev.employee_code}</span>
                  </div>
                ))}
              </div>
            </GlassCard>

            <GlassCard className="p-5">
              <h3 className="mb-3 font-semibold">Needs attention</h3>
              <div className="space-y-2">
                {(approvals?.leave ?? 0) > 0 && (
                  <ActionRow icon={Plane} tone="text-sky-600"
                    title={`${approvals?.leave} leave request${(approvals?.leave ?? 0) > 1 ? "s" : ""} awaiting review`}
                    onClick={() => navigate("/leave-admin")} />
                )}
                {(approvals?.corrections ?? 0) > 0 && (
                  <ActionRow icon={TimerReset} tone="text-amber-600"
                    title={`${approvals?.corrections} attendance correction${(approvals?.corrections ?? 0) > 1 ? "s" : ""} to review`}
                    onClick={() => navigate("/corrections")} />
                )}
                {(approvals?.devices ?? 0) > 0 && (
                  <ActionRow icon={Fingerprint} tone="text-orange-600"
                    title={`${approvals?.devices} device replacement${(approvals?.devices ?? 0) > 1 ? "s" : ""} waiting`}
                    onClick={() => navigate("/devices")} />
                )}
                {(approvals?.peopleWithoutDevice ?? 0) > 0 && (
                  <ActionRow icon={AlertTriangle} tone="text-rose-600"
                    title={`${approvals?.peopleWithoutDevice} ${(approvals?.peopleWithoutDevice ?? 0) === 1 ? "person has" : "people have"} no registered device`}
                    onClick={() => navigate("/employees")} />
                )}
                {approvals &&
                  approvals.leave === 0 &&
                  approvals.corrections === 0 &&
                  approvals.devices === 0 &&
                  approvals.peopleWithoutDevice === 0 && (
                    <p className="py-6 text-center text-sm text-muted-foreground">All clear. Nothing needs review.</p>
                  )}
              </div>
              {hasPerm(ws?.employee.role, "manage_employees") && (
                <div className="mt-4 border-t border-white/40 pt-4">
                  <Button variant="outline" className="glass w-full" onClick={() => navigate("/employees")}>
                    <Building2 className="size-4" /> Manage employees
                  </Button>
                </div>
              )}
            </GlassCard>
          </div>
        </>
      )}
    </AppShell>
  );
}

function ActionRow({ icon: Icon, tone, title, onClick }: {
  icon: React.ComponentType<{ className?: string }>;
  tone: string; title: string; onClick: () => void;
}) {
  return (
    <button onClick={onClick}
      className="glass-soft flex w-full items-center gap-3 rounded-xl px-3.5 py-3 text-left transition-colors hover:bg-white/60">
      <Icon className={`size-4.5 ${tone}`} />
      <span className="flex-1 text-sm">{title}</span>
      <ArrowRight className="size-4 text-muted-foreground" />
    </button>
  );
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "morning";
  if (h < 17) return "afternoon";
  return "evening";
}
