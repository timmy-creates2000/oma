import { AppShell, hasPerm } from "@/components/AppShell";
import { GlassCard, StatTile, PageHeader } from "@/components/glass";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, BarChart, Bar,
} from "recharts";
import {
  Users, UserCheck, Clock3, TimerReset, CalendarOff, Plane,
  Building2, ArrowRight, LogIn, LogOut, AlertTriangle, Activity, ScanLine,
} from "lucide-react";
import { useNavigate } from "react-router";
import { useEffect, useState } from "react";
import { supabase, fmtTime, err, type DashboardData, type Session } from "@/lib/sb";
import { useWorkspace } from "@/hooks/use-workspace";
import { useSupabaseAuth } from "@/hooks/use-supabase-auth";

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
  const { user } = useSupabaseAuth();
  const { ws } = useWorkspace();
  const navigate = useNavigate();
  const [dash, setDash] = useState<DashboardData | null>(null);
  const [today, setToday] = useState<Session | null>(null);

  // load dashboard data + my session, refresh on realtime inserts
  useEffect(() => {
    if (!ws) return;
    const companyId = ws.employee.company_id;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    async function load() {
      const [{ data }, { data: sessions }] = await Promise.all([
        supabase.rpc("dashboard_data"),
        supabase
          .from("attendance_sessions")
          .select("*")
          .eq("employee_id", ws!.employee.id)
          .eq("day_key", new Date().toISOString().slice(0, 10))
          .order("clock_in_at", { ascending: false })
          .limit(1),
      ]);
      if (data) setDash(data as unknown as DashboardData);
      setToday((sessions?.[0] as unknown as Session) ?? null);
    }
    load();
    const sweep = async () => {
      try { await supabase.rpc("auto_clockout_sweep"); } catch { /* noop */ }
    };
    void sweep();

    channel = supabase
      .channel("of-dashboard")
      .on("postgres_changes", { event: "*", schema: "public", table: "attendance_sessions", filter: `company_id=eq.${companyId}` }, () => load())
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "attendance_events", filter: `company_id=eq.${companyId}` }, () => load())
      .subscribe();

    const iv = setInterval(load, 60000);
    return () => {
      if (channel) supabase.removeChannel(channel);
      clearInterval(iv);
    };
  }, [ws]);

  const todayKey = new Date().toISOString().slice(0, 10);
  const myName = ws?.employee.name ?? user?.email ?? "there";

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
                {today && !today.clock_out_at ? (
                  <p className="mt-1 text-lg font-semibold">
                    Clocked in at {fmtTime(today.clock_in_at)}
                    {today.late_minutes > 0 ? ` · ${today.late_minutes}m late` : " · on time"}
                  </p>
                ) : today ? (
                  <p className="mt-1 text-lg font-semibold">
                    Done for today — {((today.worked_minutes ?? 0) / 60).toFixed(1)}h worked
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
            <StatTile icon={UserCheck} label="Present today" value={dash.counts.present + dash.counts.half_day} tone="text-emerald-600" />
            <StatTile icon={Clock3} label="Late today" value={dash.counts.late} tone="text-amber-600" />
            <StatTile icon={TimerReset} label="Currently in office" value={dash.counts.ongoing} tone="text-sky-600" />
            <StatTile icon={Plane} label="On leave" value={dash.counts.on_leave} tone="text-violet-600" />
            <StatTile icon={CalendarOff} label="Absent / not arrived" value={dash.counts.absent} tone="text-rose-600" />
            <StatTile icon={AlertTriangle} label="Missing clock-out (7d)" value={dash.counts.missing_out} tone="text-orange-600" />
            <StatTile
              icon={Activity}
              label="Pending reviews"
              value={dash.pendingLeave + dash.pendingCorrections}
              hint={`${dash.pendingLeave} leave · ${dash.pendingCorrections} corrections`}
            />
          </div>

          {/* trend + dept */}
          <div className="mt-6 grid gap-4 lg:grid-cols-3">
            <GlassCard className="p-5 lg:col-span-2">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="font-semibold">Attendance trend — last 14 days</h3>
                <Badge variant="outline" className="glass-soft text-[10px]">live</Badge>
              </div>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={(dash.trend ?? []).map((t) => ({ ...t, label: DAY_FMT(t.day) }))}>
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
                  <BarChart data={(dash.deptRows ?? []).filter(Boolean) as NonNullable<DashboardData["deptRows"][number]>[]} layout="vertical" barSize={14}>
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
                {(dash.recentEvents ?? []).filter(Boolean).length === 0 && (
                  <p className="py-6 text-center text-sm text-muted-foreground">No activity yet.</p>
                )}
                {(dash.recentEvents ?? []).filter(Boolean).map((ev0) => {
                  const ev = ev0 as NonNullable<DashboardData["recentEvents"][number]>;
                  return (
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
                      {ev.day_key === todayKey ? (
                        <Badge variant="secondary" className="bg-emerald-500/15 text-emerald-700">today</Badge>
                      ) : (
                        <span className="text-[11px] text-muted-foreground">{ev.day_key}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </GlassCard>

            <GlassCard className="p-5">
              <h3 className="mb-3 font-semibold">Needs attention</h3>
              <div className="space-y-2">
                {dash.pendingLeave > 0 && (
                  <ActionRow icon={Plane} tone="text-sky-600"
                    title={`${dash.pendingLeave} leave request${dash.pendingLeave > 1 ? "s" : ""} awaiting review`}
                    onClick={() => navigate("/leave-admin")} />
                )}
                {dash.pendingCorrections > 0 && (
                  <ActionRow icon={TimerReset} tone="text-amber-600"
                    title={`${dash.pendingCorrections} attendance correction${dash.pendingCorrections > 1 ? "s" : ""} to review`}
                    onClick={() => navigate("/corrections")} />
                )}
                {dash.counts.missing_out > 0 && (
                  <ActionRow icon={AlertTriangle} tone="text-orange-600"
                    title={`${dash.counts.missing_out} missing clock-out${dash.counts.missing_out > 1 ? "s" : ""} in the last 7 days`}
                    onClick={() => navigate("/attendance-admin")} />
                )}
                {dash.pendingLeave + dash.pendingCorrections + dash.counts.missing_out === 0 && (
                  <p className="py-6 text-center text-sm text-muted-foreground">All clear. Nothing needs review.</p>
                )}
              </div>
              {hasPerm(dash.myRole, "manage_employees") && (
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

void err;
