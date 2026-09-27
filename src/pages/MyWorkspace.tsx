import { AppShell } from "@/components/AppShell";
import { GlassCard, PageHeader, Empty, StatTile } from "@/components/glass";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Fingerprint, Plus, ShieldCheck, History, Plane, TimerReset,
  Smartphone, Loader2, ScanLine, Copy, Check, CalendarDays,
} from "lucide-react";
import { supabase, fmtTime, fmtDay, err } from "@/lib/sb";
import { useWorkspace } from "@/hooks/use-workspace";

const STATUS_META: Record<string, { label: string; cls: string }> = {
  present: { label: "Present", cls: "bg-emerald-500/15 text-emerald-700" },
  late: { label: "Late", cls: "bg-amber-500/15 text-amber-700" },
  half_day: { label: "Half day", cls: "bg-orange-500/15 text-orange-700" },
  ongoing: { label: "Working", cls: "bg-sky-500/15 text-sky-700" },
  holiday: { label: "Holiday", cls: "bg-violet-500/15 text-violet-700" },
  weekend: { label: "Weekend", cls: "bg-slate-500/15 text-slate-600" },
  on_leave: { label: "On leave", cls: "bg-sky-500/15 text-sky-700" },
  absent: { label: "Absent", cls: "bg-rose-500/15 text-rose-700" },
};

const DEVICE_STATUS_META: Record<string, { label: string; cls: string }> = {
  active: { label: "Active", cls: "bg-emerald-500/15 text-emerald-700" },
  pending_replacement: { label: "Replacement pending", cls: "bg-amber-500/15 text-amber-700" },
  revoked: { label: "Revoked", cls: "bg-rose-500/15 text-rose-700" },
};

type BalanceRow = { id: string; leave_type_id: string; used_days: number; leave_types: { name: string; annual_quota_days: number } | null };
type LeaveRow = { id: string; leave_type_id: string; start_date: string; end_date: string; reason: string; status: string; leave_types: { name: string } | null };
type CorrectionRow = { id: string; session_date: string; reason: string; status: string; reviewer_note: string | null };
type DeviceRow = { id: string; label: string; platform: string; status: string; public_key_fingerprint: string; registered_at: string };

export default function MyWorkspace() {
  const { ws } = useWorkspace();
  const [today, setToday] = useState<Session0 | null>(null);
  const [history, setHistory] = useState<Session0[]>([]);
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [balances, setBalances] = useState<BalanceRow[]>([]);
  const [myLeave, setMyLeave] = useState<LeaveRow[]>([]);
  const [myCorrections, setMyCorrections] = useState<CorrectionRow[]>([]);
  const [leaveTypes, setLeaveTypes] = useState<Array<{ id: string; name: string; annual_quota_days: number }>>([]);
  const [token, setToken] = useState<{ raw: string; expiresAt: number } | null>(null);
  const [scanning, setScanning] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = async () => {
    if (!ws) return;
    const me = ws.employee.id;
    const dk = new Date().toISOString().slice(0, 10);
    const [s, h, d, b, l, c, lt] = await Promise.all([
      supabase.from("attendance_sessions").select("*").eq("employee_id", me).eq("day_key", dk).maybeSingle(),
      supabase.from("attendance_sessions").select("*").eq("employee_id", me).order("clock_in_at", { ascending: false }).limit(60),
      supabase.from("registered_devices").select("*").eq("employee_id", me).order("registered_at", { ascending: false }),
      supabase.from("leave_balances").select("*, leave_types(name, annual_quota_days)").eq("employee_id", me).eq("year", new Date().getFullYear()),
      supabase.from("leave_requests").select("*, leave_types(name)").eq("employee_id", me).order("created_at", { ascending: false }),
      supabase.from("correction_requests").select("*").eq("employee_id", me).order("created_at", { ascending: false }),
      supabase.from("leave_types").select("id, name, annual_quota_days").eq("company_id", ws.employee.company_id),
    ]);
    setToday((s.data ?? null) as Session0 | null);
    setHistory((h.data ?? []) as Session0[]);
    setDevices((d.data ?? []) as DeviceRow[]);
    setBalances((b.data ?? []) as BalanceRow[]);
    setMyLeave((l.data ?? []) as LeaveRow[]);
    setMyCorrections((c.data ?? []) as CorrectionRow[]);
    setLeaveTypes((lt.data ?? []) as Array<{ id: string; name: string; annual_quota_days: number }>);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws]);

  // live demo token from any active kiosk in the company
  useEffect(() => {
    if (!ws) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function pull() {
      const { data: displays } = await supabase
        .from("qr_displays").select("id").eq("company_id", ws!.employee.company_id).eq("active", true).limit(1);
      const disp = (displays as Array<{ id: string }> | null)?.[0];
      if (disp) {
        const { data } = await supabase.rpc("issue_qr_token", { p_display: disp.id });
        const v = data as { raw: string; expiresAt: number } | null;
        if (!stop && v) setToken({ raw: (v as any).raw, expiresAt: Number((v as any).expiresAt) });
      }
      if (!stop) timer = setTimeout(pull, 25000);
    }
    pull();
    return () => { stop = true; if (timer) clearTimeout(timer); };
  }, [ws]);

  const activeDevice = devices.find((d) => d.status === "active");
  const openSession = today && !today.clock_out_at && today.status !== "on_leave";
  const canScan = !!activeDevice && !!token;

  const handleScan = async () => {
    if (!token || !activeDevice) return;
    setScanning(true);
    try {
      const { data, error } = await supabase.rpc("scan_qr", {
        p_raw: token.raw,
        p_device: activeDevice.id,
      });
      if (error) throw error;
      const res = data as { message: string; action: string };
      toast.success(res.message, { description: res.action === "clock_in" ? "Clock-in recorded" : "Clock-out recorded" });
      await load();
    } catch (e) {
      toast.error(err(e));
    } finally {
      setScanning(false);
    }
  };

  const copyToken = async () => {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token.raw);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Clipboard unavailable");
    }
  };

  // device registration
  const [regOpen, setRegOpen] = useState(false);
  const [devLabel, setDevLabel] = useState("");
  const [devPlatform, setDevPlatform] = useState("iOS");
  const handleRegisterDevice = async () => {
    try {
      const { error } = await supabase.rpc("register_device", { p_label: devLabel || "My device", p_platform: devPlatform });
      if (error) throw error;
      toast.success("Device registered", { description: "You can now scan to clock in/out." });
      setRegOpen(false);
      setDevLabel("");
      load();
    } catch (e) {
      toast.error(err(e));
    }
  };

  // leave request
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [leaveType, setLeaveType] = useState("");
  const [leaveStart, setLeaveStart] = useState("");
  const [leaveEnd, setLeaveEnd] = useState("");
  const [leaveReason, setLeaveReason] = useState("");
  const handleRequestLeave = async () => {
    try {
      const { error } = await supabase.rpc("request_leave", {
        p_type: leaveType, p_start: leaveStart, p_end: leaveEnd, p_reason: leaveReason,
      });
      if (error) throw error;
      toast.success("Leave request submitted");
      setLeaveOpen(false);
      setLeaveReason("");
      load();
    } catch (e) {
      toast.error(err(e));
    }
  };

  // correction request
  const [corrOpen, setCorrOpen] = useState(false);
  const [corrDate, setCorrDate] = useState("");
  const [corrIn, setCorrIn] = useState("");
  const [corrOut, setCorrOut] = useState("");
  const [corrReason, setCorrReason] = useState("");
  const handleRequestCorrection = async () => {
    try {
      const toTs = (d: string, t: string) => (d && t ? new Date(`${d}T${t}:00Z`).toISOString() : null);
      const { error } = await supabase.rpc("request_correction", {
        p_date: corrDate,
        p_in: toTs(corrDate, corrIn),
        p_out: corrOut ? toTs(corrDate, corrOut) : null,
        p_reason: corrReason,
      });
      if (error) throw error;
      toast.success("Correction request submitted");
      setCorrOpen(false);
      setCorrReason("");
      load();
    } catch (e) {
      toast.error(err(e));
    }
  };

  if (!ws) {
    return (
      <AppShell title="My workspace">
        <div className="glass rounded-2xl p-8 text-center text-sm text-muted-foreground">Loading…</div>
      </AppShell>
    );
  }

  return (
    <AppShell title="My workspace">
      <PageHeader
        title="My workspace"
        subtitle={`${ws.employee.name} · ${ws.employee.employee_code}${ws.employee.position ? ` · ${ws.employee.position}` : ""}`}
      />

      {/* clock card */}
      <GlassCard strong className="mb-6 p-6">
        <div className="flex flex-col items-center gap-5 sm:flex-row sm:justify-between">
          <div className="flex items-center gap-4">
            <div className="glass-inset flex size-16 items-center justify-center rounded-2xl">
              <ScanLine className="size-7 text-primary" />
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground">Attendance status</p>
              {openSession ? (
                <p className="text-xl font-bold">Working since {fmtTime(today!.clock_in_at)}</p>
              ) : today ? (
                <p className="text-xl font-bold">Clocked out at {fmtTime(today.clock_out_at)}</p>
              ) : (
                <p className="text-xl font-bold">Ready to clock in</p>
              )}
              <p className="mt-0.5 text-xs text-muted-foreground">
                {activeDevice ? `Device: ${activeDevice.label}` : "No active device — register one below to scan."}
              </p>
            </div>
          </div>
          <div className="flex flex-col items-center gap-2">
            <Button size="lg" className="h-14 w-44 text-base shadow-xl shadow-primary/25"
              disabled={!canScan || scanning} onClick={handleScan}>
              {scanning ? <Loader2 className="size-5 animate-spin" /> : <ScanLine className="size-5" />}
              {openSession ? "Scan to clock out" : "Scan to clock in"}
            </Button>
            {!activeDevice && (
              <p className="max-w-48 text-center text-[11px] text-muted-foreground">Register a device first</p>
            )}
            {token && (
              <button className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground"
                onClick={copyToken} title="Copy current token (for testing)">
                {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
                {copied ? "Copied" : "Copy token"}
              </button>
            )}
          </div>
        </div>
        {today?.worked_minutes != null && (
          <p className="mt-3 text-center text-xs text-muted-foreground">
            Worked {((today.worked_minutes ?? 0) / 60).toFixed(1)}h today
          </p>
        )}
      </GlassCard>

      {/* stats row */}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile icon={CalendarDays} label="Today" value={STATUS_META[today?.status ?? "absent"]?.label ?? "—"} />
        <StatTile icon={Fingerprint} label="Active devices" value={devices.filter((d) => d.status === "active").length} />
        <StatTile
          icon={Plane}
          label="Leave balance"
          value={balances.reduce((a, b) => a + Math.max(0, (b.leave_types?.annual_quota_days ?? 0) - Number(b.used_days)), 0)}
          hint="days remaining"
        />
        <StatTile icon={TimerReset} label="Corrections" value={myCorrections.filter((c) => c.status === "pending").length} hint="pending" />
      </div>

      <Tabs defaultValue="history" className="space-y-4">
        <TabsList className="glass flex h-auto w-full flex-wrap gap-1 rounded-xl p-1">
          <TabsTrigger value="history" className="rounded-lg">History</TabsTrigger>
          <TabsTrigger value="devices" className="rounded-lg">Devices</TabsTrigger>
          <TabsTrigger value="leave" className="rounded-lg">Leave</TabsTrigger>
          <TabsTrigger value="corrections" className="rounded-lg">Corrections</TabsTrigger>
        </TabsList>

        <TabsContent value="history">
          <GlassCard className="p-5">
            <h3 className="mb-3 flex items-center gap-2 font-semibold">
              <History className="size-4 text-primary" /> Attendance history
            </h3>
            {history.length === 0 ? (
              <Empty icon={History} text="No attendance records yet — scan to clock in." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/50 text-left text-xs text-muted-foreground">
                      <th className="py-2 pr-3 font-medium">Date</th>
                      <th className="py-2 pr-3 font-medium">In</th>
                      <th className="py-2 pr-3 font-medium">Out</th>
                      <th className="py-2 pr-3 font-medium">Worked</th>
                      <th className="py-2 pr-3 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((s) => (
                      <tr key={s.id} className="border-b border-white/30 last:border-0">
                        <td className="py-2.5 pr-3 font-medium">{fmtDay(s.day_key)}</td>
                        <td className="py-2.5 pr-3">{fmtTime(s.clock_in_at)}</td>
                        <td className="py-2.5 pr-3">{s.clock_out_at ? fmtTime(s.clock_out_at) : "—"}</td>
                        <td className="py-2.5 pr-3">{s.worked_minutes != null ? `${(s.worked_minutes / 60).toFixed(1)}h` : "—"}</td>
                        <td className="py-2.5 pr-3">
                          <Badge variant="secondary" className={STATUS_META[s.status]?.cls ?? ""}>
                            {STATUS_META[s.status]?.label ?? s.status}
                          </Badge>
                          {s.late_minutes > 0 && <span className="ml-1.5 text-[10px] text-amber-700">+{s.late_minutes}m</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </GlassCard>
        </TabsContent>

        <TabsContent value="devices">
          <GlassCard className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="flex items-center gap-2 font-semibold">
                <Smartphone className="size-4 text-primary" /> Registered devices
              </h3>
              <Dialog open={regOpen} onOpenChange={setRegOpen}>
                <DialogTrigger asChild>
                  <Button size="sm"><Plus className="size-4" /> Register device</Button>
                </DialogTrigger>
                <DialogContent className="glass-strong">
                  <DialogHeader>
                    <DialogTitle>Register a device</DialogTitle>
                    <DialogDescription>
                      A device-bound key fingerprint is created. Only HR can approve replacements.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-3">
                    <div>
                      <Label htmlFor="dlabel">Device name</Label>
                      <Input id="dlabel" className="mt-1.5" placeholder="iPhone 15 Pro" value={devLabel} onChange={(e) => setDevLabel(e.target.value)} />
                    </div>
                    <div>
                      <Label>Platform</Label>
                      <Select value={devPlatform} onValueChange={setDevPlatform}>
                        <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="iOS">iOS</SelectItem>
                          <SelectItem value="Android">Android</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" className="glass" onClick={() => setRegOpen(false)}>Cancel</Button>
                    <Button onClick={handleRegisterDevice}>Register</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
            {devices.length === 0 ? (
              <Empty icon={Smartphone} text="No devices registered yet." />
            ) : (
              <div className="space-y-2">
                {devices.map((d) => {
                  const meta = DEVICE_STATUS_META[d.status];
                  return (
                    <div key={d.id} className="glass-soft flex flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="glass-inset flex size-9 items-center justify-center rounded-lg">
                          <Smartphone className="size-4 text-primary" />
                        </div>
                        <div>
                          <p className="text-sm font-semibold">{d.label} <span className="ml-1 text-xs font-normal text-muted-foreground">· {d.platform}</span></p>
                          <p className="font-mono text-[10px] text-muted-foreground">fp:{d.public_key_fingerprint.slice(0, 16)}…</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className={meta?.cls ?? ""}>{meta?.label ?? d.status}</Badge>
                        {d.status === "active" && (
                          <Button size="sm" variant="outline" className="glass h-7 text-xs"
                            onClick={async () => {
                              try {
                                const { error } = await supabase.rpc("request_device_replacement", { p_device: d.id, p_reason: "Lost / replacing device" });
                                if (error) throw error;
                                toast.success("Replacement requested — HR will review.");
                                load();
                              } catch (e) { toast.error(err(e)); }
                            }}>
                            Request replacement
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="glass-soft mt-4 flex items-start gap-2.5 rounded-xl p-3.5 text-xs text-muted-foreground">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" />
              Only a fingerprint of your device key is stored — never private key material.
              Lost device? HR revokes it instantly; scans from revoked devices are rejected server-side.
            </div>
          </GlassCard>
        </TabsContent>

        <TabsContent value="leave">
          <div className="grid gap-4 lg:grid-cols-3">
            <GlassCard className="p-5">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-semibold">Balances</h3>
                <Dialog open={leaveOpen} onOpenChange={setLeaveOpen}>
                  <DialogTrigger asChild>
                    <Button size="sm"><Plus className="size-4" /> Request</Button>
                  </DialogTrigger>
                  <DialogContent className="glass-strong">
                    <DialogHeader>
                      <DialogTitle>Request leave</DialogTitle>
                      <DialogDescription>Balance is checked and deducted on approval.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3">
                      <div>
                        <Label>Type</Label>
                        <Select value={leaveType} onValueChange={setLeaveType}>
                          <SelectTrigger className="mt-1.5"><SelectValue placeholder="Select type" /></SelectTrigger>
                          <SelectContent>
                            {leaveTypes.map((t) => (
                              <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Label>From</Label>
                          <Input type="date" className="mt-1.5" value={leaveStart} onChange={(e) => setLeaveStart(e.target.value)} />
                        </div>
                        <div>
                          <Label>To</Label>
                          <Input type="date" className="mt-1.5" value={leaveEnd} onChange={(e) => setLeaveEnd(e.target.value)} />
                        </div>
                      </div>
                      <div>
                        <Label>Reason</Label>
                        <Textarea className="mt-1.5" rows={3} value={leaveReason} onChange={(e) => setLeaveReason(e.target.value)} placeholder="Short reason" />
                      </div>
                    </div>
                    <DialogFooter>
                      <Button variant="outline" className="glass" onClick={() => setLeaveOpen(false)}>Cancel</Button>
                      <Button onClick={handleRequestLeave} disabled={!leaveType || !leaveStart || !leaveEnd}>Submit request</Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
              {balances.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
              ) : (
                <div className="space-y-2.5">
                  {balances.map((b) => {
                    const quota = b.leave_types?.annual_quota_days ?? 0;
                    const remaining = Math.max(0, quota - Number(b.used_days));
                    const pct = quota > 0 ? remaining / quota : 0;
                    return (
                      <div key={b.id} className="glass-soft rounded-xl p-3.5">
                        <div className="flex items-center justify-between text-sm">
                          <span className="font-medium">{b.leave_types?.name ?? "Leave"}</span>
                          <span className="text-muted-foreground">{remaining} / {quota} days</span>
                        </div>
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/50">
                          <div className="h-full rounded-full bg-gradient-to-r from-primary/80 to-primary/50" style={{ width: `${pct * 100}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </GlassCard>

            <GlassCard className="p-5 lg:col-span-2">
              <h3 className="mb-3 font-semibold">My requests</h3>
              {myLeave.length === 0 ? (
                <Empty icon={Plane} text="No leave requests yet." />
              ) : (
                <div className="space-y-2">
                  {myLeave.map((r) => (
                    <div key={r.id} className="glass-soft flex flex-wrap items-center justify-between gap-2 rounded-xl px-4 py-3">
                      <div>
                        <p className="text-sm font-medium">{r.leave_types?.name ?? "Leave"} · {r.start_date} → {r.end_date}</p>
                        <p className="text-xs text-muted-foreground">{r.reason}</p>
                      </div>
                      <Badge variant="secondary" className={
                        r.status === "approved" ? "bg-emerald-500/15 text-emerald-700"
                        : r.status === "rejected" ? "bg-rose-500/15 text-rose-700"
                        : r.status === "cancelled" ? "bg-slate-500/15 text-slate-600"
                        : "bg-amber-500/15 text-amber-700"
                      }>
                        {r.status}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </GlassCard>
          </div>
        </TabsContent>

        <TabsContent value="corrections">
          <GlassCard className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="flex items-center gap-2 font-semibold">
                <TimerReset className="size-4 text-primary" /> Correction requests
              </h3>
              <Dialog open={corrOpen} onOpenChange={setCorrOpen}>
                <DialogTrigger asChild>
                  <Button size="sm"><Plus className="size-4" /> New correction</Button>
                </DialogTrigger>
                <DialogContent className="glass-strong">
                  <DialogHeader>
                    <DialogTitle>Request attendance correction</DialogTitle>
                    <DialogDescription>
                      HR reviews every request; approved changes rewrite the session and leave an audit trail.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-3">
                    <div>
                      <Label>Date</Label>
                      <Input type="date" className="mt-1.5" value={corrDate} onChange={(e) => setCorrDate(e.target.value)} />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label>Correct clock-in</Label>
                        <Input type="time" className="mt-1.5" value={corrIn} onChange={(e) => setCorrIn(e.target.value)} />
                      </div>
                      <div>
                        <Label>Correct clock-out</Label>
                        <Input type="time" className="mt-1.5" value={corrOut} onChange={(e) => setCorrOut(e.target.value)} />
                      </div>
                    </div>
                    <div>
                      <Label>Reason</Label>
                      <Textarea className="mt-1.5" rows={3} value={corrReason} onChange={(e) => setCorrReason(e.target.value)} placeholder="Why is this correction needed?" />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" className="glass" onClick={() => setCorrOpen(false)}>Cancel</Button>
                    <Button onClick={handleRequestCorrection} disabled={!corrDate || !corrReason}>Submit</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
            {myCorrections.length === 0 ? (
              <Empty icon={TimerReset} text="No correction requests yet." />
            ) : (
              <div className="space-y-2">
                {myCorrections.map((c) => (
                  <div key={c.id} className="glass-soft rounded-xl px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-medium">{c.session_date}</p>
                      <Badge variant="secondary" className={
                        c.status === "approved" ? "bg-emerald-500/15 text-emerald-700"
                        : c.status === "rejected" ? "bg-rose-500/15 text-rose-700"
                        : "bg-amber-500/15 text-amber-700"
                      }>
                        {c.status}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{c.reason}</p>
                    {c.reviewer_note && <p className="mt-1 text-xs italic text-muted-foreground">HR: {c.reviewer_note}</p>}
                  </div>
                ))}
              </div>
            )}
          </GlassCard>
        </TabsContent>
      </Tabs>
    </AppShell>
  );
}

type Session0 = {
  id: string;
  day_key: string;
  clock_in_at: string;
  clock_out_at: string | null;
  break_minutes: number;
  status: string;
  late_minutes: number;
  worked_minutes: number | null;
};
