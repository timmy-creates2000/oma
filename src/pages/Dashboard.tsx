import { AppShell, hasPerm } from "@/components/AppShell";
import { GlassCard, StatTile, PageHeader } from "@/components/glass";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useMutation, useQuery } from "convex/react";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, BarChart, Bar,
} from "recharts";
import {
  Users, UserCheck, Clock3, TimerReset, CalendarOff, Plane,
  Building2, ArrowRight, LogIn, LogOut, AlertTriangle, Activity, ScanLine, Fingerprint,
} from "lucide-react";
import { useNavigate } from "react-router";
import { useEffect } from "react";
import { api, fmtTime } from "@/lib/api";

const DAY_FMT = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });

const tooltipStyle = {
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.6)",
  background: "rgba(255,255,255,0.88)",
  backdropFilter: "blur(12px)",
  fontSize: 12,
} as const;

export default function Dashboard() {
  const navigate = useNavigate();
  const dash = useQuery(api.analytics.dashboardData);
  const today = useQuery(api.attendance.todayStatus);
  const ws = useQuery(api.companies.myWorkspace);
  const sweep = useMutation(api.attendance.autoClockoutSweep);

  // Close anything left open past the company's auto clock-out limit.
  useEffect(() => {
    if (!ws || !dash?.approvals?.isAdmin) return;
    void sweep({}).catch(() => undefined);
  }, [ws, dash?.approvals, sweep]);

  const myName = ws?.employee.name ?? "there";
  const mySession = today?.session ?? null;
  const approvals = dash?.approvals;

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
                {mySession && mySession.clockOutAt === undefined ? (
                  <p className="mt-1 text-lg font-semibold">
                    Clocked in at {fmtTime(mySession.clockInAt)}
                    {mySession.lateMinutes > 0 ? ` · ${mySession.lateMinutes}m late` : " · on time"}
                  </p>
                ) : mySession ? (
                  <p className="mt-1 text-lg font-semibold">
                    Done for today — {((mySession.workedMinutes ?? 0) / 60).toFixed(1)}h worked
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
            <StatTile icon={Users} label="Total employees" value={dash.headcount} />
            <StatTile icon={UserCheck} label="Present today" value={dash.todaySummary.present} tone="text-emerald-600" />
            <StatTile icon={Clock3} label="Late today" value={dash.todaySummary.late} tone="text-amber-600" />
            <StatTile icon={TimerReset} label="Currently in office" value={dash.todaySummary.ongoing} tone="text-sky-600" />
            <StatTile icon={Plane} label="On leave" value={dash.todaySummary.onLeave} tone="text-violet-600" />
            <StatTile icon={CalendarOff} label="Absent / not arrived" value={dash.todaySummary.absent} tone="text-rose-600" />
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
                {dash.activity.length === 0 && (
                  <p className="py-6 text-center text-sm text-muted-foreground">No activity yet.</p>
                )}
                {dash.activity.map((ev) => (
                  <div key={ev.id} className="glass-soft flex items-center justify-between rounded-xl px-3.5 py-2.5">
                    <div className="flex items-center gap-2.5">
                      {ev.kind === "clock_out" ? (
                        <LogOut className="size-3.5 text-rose-500" />
                      ) : (
                        <LogIn className="size-3.5 text-emerald-500" />
                      )}
                      <div>
                        <p className="text-sm font-medium">{ev.name}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {ev.kind === "clock_out" ? "Clocked out" : ev.kind === "clock_in" ? "Clocked in" : "Auto clock-out"} · {fmtTime(ev.at)}
                        </p>
                      </div>
                    </div>
                    <span className="text-[11px] text-muted-foreground">{ev.employeeCode}</span>
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
