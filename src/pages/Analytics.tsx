import { AppShell } from "@/components/AppShell";
import { GlassCard, PageHeader } from "@/components/glass";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, BarChart, Bar, Legend,
} from "recharts";
import { useEffect, useMemo, useState } from "react";
import {
  RefreshCw, Gauge, Timer, Clock3, Flame, Sunset, ArrowDownRight, Plane,
} from "lucide-react";
import { supabase, type RangeData } from "@/lib/sb";
import { useWorkspace } from "@/hooks/use-workspace";

const tooltipStyle = {
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.6)",
  background: "rgba(255,255,255,0.88)",
  backdropFilter: "blur(12px)",
  fontSize: 12,
} as const;

function shiftDays(days: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const PRESETS = [
  { id: "30", label: "Last 30 days", from: shiftDays(-29), to: shiftDays(0) },
  { id: "90", label: "Last 90 days", from: shiftDays(-89), to: shiftDays(0) },
  { id: "custom", label: "Custom range", from: "", to: "" },
];

export default function Analytics() {
  const { ws } = useWorkspace();
  const [preset, setPreset] = useState("30");
  const [from, setFrom] = useState(PRESETS[0].from);
  const [to, setTo] = useState(PRESETS[0].to);
  const [dept, setDept] = useState("all");
  const [branch, setBranch] = useState("all");
  const [emp, setEmp] = useState("all");
  const [departments, setDepartments] = useState<Array<{ id: string; name: string }>>([]);
  const [branches, setBranches] = useState<Array<{ id: string; name: string }>>([]);
  const [employees, setEmployees] = useState<Array<{ id: string; name: string }>>([]);
  const [data, setData] = useState<RangeData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!ws) return;
    const cid = ws.employee.company_id;
    (async () => {
      const [d, b, e] = await Promise.all([
        supabase.from("departments").select("id, name").eq("company_id", cid).order("name"),
        supabase.from("branches").select("id, name").eq("company_id", cid).order("name"),
        supabase.from("employees").select("id, name").eq("company_id", cid).eq("active", true).order("name"),
      ]);
      setDepartments((d.data ?? []) as Array<{ id: string; name: string }>);
      setBranches((b.data ?? []) as Array<{ id: string; name: string }>);
      setEmployees((e.data ?? []) as Array<{ id: string; name: string }>);
    })();
  }, [ws]);

  const activePreset = PRESETS.find((p) => p.id === preset);
  const fromD = preset === "custom" ? from : activePreset?.from ?? from;
  const toD = preset === "custom" ? to : activePreset?.to ?? to;

  useEffect(() => {
    if (!ws || !fromD || !toD) return;
    setLoading(true);
    (async () => {
      const { data: v, error } = await supabase.rpc("analytics_range", {
        p_from: fromD,
        p_to: toD,
        p_department: dept === "all" ? null : dept,
        p_branch: branch === "all" ? null : branch,
        p_employee: emp === "all" ? null : emp,
      });
      if (!error && v) setData(v as unknown as RangeData);
      setLoading(false);
    })();
  }, [ws, fromD, toD, dept, branch, emp]);

  const trend = useMemo(
    () => (data ? data.daily.map((d) => ({ ...d, label: d.day.slice(5) })) : []),
    [data],
  );
  const metrics = data?.totals;

  return (
    <AppShell title="Analytics">
      <PageHeader
        title="Analytics"
        subtitle="Attendance health across any period, department or branch."
      />

      <GlassCard className="mb-4 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
        <Select value={preset} onValueChange={(v) => {
          setPreset(v);
          const p = PRESETS.find((x) => x.id === v);
          if (p?.from) { setFrom(p.from); setTo(p.to); }
        }}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {PRESETS.map((p) => <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>)}
          </SelectContent>
        </Select>
        {preset === "custom" && (
          <>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </>
        )}
        <Select value={dept} onValueChange={setDept}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All departments</SelectItem>
            {departments.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={branch} onValueChange={setBranch}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All branches</SelectItem>
            {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={emp} onValueChange={setEmp}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All employees</SelectItem>
            {employees.slice(0, 100).map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </GlassCard>

      {loading || !data ? (
        <GlassCard className="p-10 text-center text-sm text-muted-foreground">
          <RefreshCw className="mx-auto mb-2 size-5 animate-spin" /> Loading analytics…
        </GlassCard>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Metric icon={Gauge} label="Attendance rate" value={`${metrics!.attendanceRate}%`} tone="text-primary" />
            <Metric icon={Timer} label="Punctuality rate" value={`${metrics!.punctualityRate}%`} tone="text-emerald-600" />
            <Metric icon={Clock3} label="Avg arrival" value={metrics!.avgArrival} hint={`departure ~ ${metrics!.avgDeparture}`} />
            <Metric icon={Flame} label="Avg worked" value={`${metrics!.avgWorkedHours}h`} hint="per session" />
            <Metric icon={Sunset} label="Late minutes" value={metrics!.totalLateMinutes} hint="total in range" tone="text-amber-600" />
            <Metric icon={Flame} label="Overtime" value={`${metrics!.totalOvertimeHours}h`} tone="text-emerald-600" />
            <Metric icon={ArrowDownRight} label="Early departures" value={metrics!.earlyDepartures} tone="text-orange-600" />
            <Metric icon={Plane} label="Leave days" value={metrics!.leaveDays} tone="text-sky-600" />
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <GlassCard className="p-5">
              <h3 className="mb-4 font-semibold">Daily attendance</h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={trend}>
                    <defs>
                      <linearGradient id="aP" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#6366f1" stopOpacity={0.45} />
                        <stop offset="100%" stopColor="#6366f1" stopOpacity={0.05} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(100,116,139,0.15)" vertical={false} />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={10} interval="preserveStartEnd" />
                    <YAxis tickLine={false} axisLine={false} fontSize={11} allowDecimals={false} width={26} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Area type="monotone" dataKey="present" name="Present" stroke="#6366f1" fill="url(#aP)" strokeWidth={2} />
                    <Line type="monotone" dataKey="late" name="Late" stroke="#f59e0b" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="absent" name="Absent" stroke="#f43f5e" strokeWidth={2} strokeDasharray="4 3" dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </GlassCard>

            <GlassCard className="p-5">
              <h3 className="mb-4 font-semibold">Worked hours by employee</h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.perEmployee.slice(0, 12)}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(100,116,139,0.15)" vertical={false} />
                    <XAxis dataKey="name" tick={false} axisLine={false} />
                    <YAxis tickLine={false} axisLine={false} fontSize={11} width={26} />
                    <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`${v}h`, "Worked"]} />
                    <Bar dataKey="worked_hours" fill="#6366f1" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <p className="mt-2 text-center text-[11px] text-muted-foreground">First 12 employees in current filter</p>
            </GlassCard>
          </div>

          <GlassCard className="mt-4 overflow-x-auto p-2">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/50 text-left text-xs text-muted-foreground">
                  <th className="px-3 py-3 font-medium">Employee</th>
                  <th className="px-3 py-3 font-medium">Dept</th>
                  <th className="px-3 py-3 font-medium">Present</th>
                  <th className="px-3 py-3 font-medium">Late</th>
                  <th className="px-3 py-3 font-medium">Half</th>
                  <th className="px-3 py-3 font-medium">Leave</th>
                  <th className="px-3 py-3 font-medium">Hours</th>
                  <th className="px-3 py-3 font-medium">OT</th>
                  <th className="px-3 py-3 font-medium">Late min</th>
                </tr>
              </thead>
              <tbody>
                {data.perEmployee.map((r) => (
                  <tr key={r.employee_id} className="border-b border-white/30 last:border-0">
                    <td className="px-3 py-2.5">
                      <p className="font-medium">{r.name}</p>
                      <p className="text-[11px] text-muted-foreground">{r.code}</p>
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground">{r.department}</td>
                    <td className="px-3 py-2.5">{r.present_days}</td>
                    <td className="px-3 py-2.5">{r.late_days}</td>
                    <td className="px-3 py-2.5">{r.half_days}</td>
                    <td className="px-3 py-2.5">{r.leave_days}</td>
                    <td className="px-3 py-2.5 font-medium">{r.worked_hours}</td>
                    <td className="px-3 py-2.5">{r.overtime_hours || "—"}</td>
                    <td className="px-3 py-2.5">{r.late_minutes || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </GlassCard>
        </>
      )}
    </AppShell>
  );
}

function Metric({ icon: Icon, label, value, tone = "", hint }: {
  icon: React.ComponentType<{ className?: string }>;
  label: string; value: React.ReactNode; tone?: string; hint?: string;
}) {
  return (
    <GlassCard className="p-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          <p className={`mt-1 text-2xl font-bold ${tone}`}>{value}</p>
          {hint && <p className="text-[11px] text-muted-foreground/80">{hint}</p>}
        </div>
        <div className="glass-inset flex size-9 items-center justify-center rounded-xl">
          <Icon className="size-4.5" />
        </div>
      </div>
    </GlassCard>
  );
}
