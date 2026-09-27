import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
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
import {
  Tabs, TabsContent, TabsList, TabsTrigger,
} from "@/components/ui/tabs";
import { useQuery, useMutation } from "convex/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Fingerprint, Plus, ShieldCheck, ShieldX, History, Plane,
  TimerReset, Smartphone, Loader2, ScanLine, Copy, Check, CalendarDays,
} from "lucide-react";

function fmtTime(ts: number) {
  return new Date(ts).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
}
function fmtDay(dk: string) {
  return new Date(`${dk}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric", timeZone: "UTC",
  });
}

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

export default function MyWorkspace() {
  const ws = useQuery(api.workspace.get);
  const today = useQuery(api.attendance.myToday, {});
  const history = useQuery(api.attendance.myHistory, { limit: 60 });
  const myDevices = useQuery(api.devices.myDevices, {});
  const balances = useQuery(api.leave.myBalances, {});
  const myLeave = useQuery(api.leave.myRequests, {});
  const myCorrections = useQuery(api.attendance.myCorrections, {});
  const registerDevice = useMutation(api.devices.register);
  const requestReplacement = useMutation(api.devices.requestReplacement);
  const requestLeave = useMutation(api.leave.request);
  const requestCorrection = useMutation(api.attendance.requestCorrection);

  // ---- scan flow: employee submits the current kiosk token ----
  const activeDisplays = useQuery(api.qrDisplays.list, {});
  const currentToken = useQuery(api.attendance.currentTokenForScanning, {});
  const scan = useMutation(api.attendance.scanQr);
  const [scanning, setScanning] = useState(false);
  const [copied, setCopied] = useState(false);

  const activeDevice = (myDevices ?? []).find((d) => d.status === "active");
  const openSession = today && !today.clockOutAt && today.status !== "on_leave";
  const canScan = !!activeDevice && !!currentToken;

  const handleScan = async () => {
    if (!currentToken || !activeDevice) return;
    setScanning(true);
    try {
      const res = await scan({
        rawToken: currentToken.raw,
        deviceId: activeDevice._id,
      });
      toast.success(res.message, {
        description: res.action === "clock_in" ? "Clock-in recorded" : "Clock-out recorded",
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Scan failed");
    } finally {
      setScanning(false);
    }
  };

  const copyToken = async () => {
    if (!currentToken) return;
    try {
      await navigator.clipboard.writeText(currentToken.raw);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Clipboard unavailable");
    }
  };

  // ---- device registration ----
  const [regOpen, setRegOpen] = useState(false);
  const [devLabel, setDevLabel] = useState("");
  const [devPlatform, setDevPlatform] = useState("iOS");

  const handleRegisterDevice = async () => {
    try {
      await registerDevice({
        label: devLabel || "My device",
        platform: devPlatform,
        publicKeyMock: `${ws?.employee.email}:${devLabel}:${Date.now()}`,
      });
      toast.success("Device registered", { description: "You can now scan to clock in/out." });
      setRegOpen(false);
      setDevLabel("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Registration failed");
    }
  };

  // ---- leave request ----
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [leaveType, setLeaveType] = useState("");
  const [leaveStart, setLeaveStart] = useState("");
  const [leaveEnd, setLeaveEnd] = useState("");
  const [leaveReason, setLeaveReason] = useState("");

  const handleRequestLeave = async () => {
    try {
      await requestLeave({
        leaveTypeId: leaveType as any,
        startDate: leaveStart,
        endDate: leaveEnd,
        reason: leaveReason,
      });
      toast.success("Leave request submitted");
      setLeaveOpen(false);
      setLeaveReason("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Request failed");
    }
  };

  // ---- correction request ----
  const [corrOpen, setCorrOpen] = useState(false);
  const [corrDate, setCorrDate] = useState("");
  const [corrIn, setCorrIn] = useState("");
  const [corrOut, setCorrOut] = useState("");
  const [corrReason, setCorrReason] = useState("");

  const handleRequestCorrection = async () => {
    try {
      const toTs = (d: string, t: string) => (d && t ? new Date(`${d}T${t}:00Z`).getTime() : undefined);
      await requestCorrection({
        sessionDate: corrDate,
        requestedClockInAt: toTs(corrDate, corrIn),
        requestedClockOutAt: corrOut ? toTs(corrDate, corrOut) : undefined,
        reason: corrReason,
      });
      toast.success("Correction request submitted");
      setCorrOpen(false);
      setCorrReason("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Request failed");
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
        subtitle={`${ws.employee.name} · ${ws.employee.employeeCode}${ws.employee.position ? ` · ${ws.employee.position}` : ""}`}
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
                <p className="text-xl font-bold">
                  Working since {fmtTime(today!.clockInAt)}
                </p>
              ) : today ? (
                <p className="text-xl font-bold">
                  Clocked out at {today.clockOutAt ? fmtTime(today.clockOutAt) : "—"}
                </p>
              ) : (
                <p className="text-xl font-bold">Ready to clock in</p>
              )}
              <p className="mt-0.5 text-xs text-muted-foreground">
                {activeDevice
                  ? `Device: ${activeDevice.label}`
                  : "No active device — register one below to scan."}
              </p>
            </div>
          </div>
          <div className="flex flex-col items-center gap-2">
            <Button
              size="lg"
              className="h-14 w-44 text-base shadow-xl shadow-primary/25"
              disabled={!canScan || scanning}
              onClick={handleScan}
            >
              {scanning ? <Loader2 className="size-5 animate-spin" /> : <ScanLine className="size-5" />}
              {openSession ? "Scan to clock out" : "Scan to clock in"}
            </Button>
            {!activeDevice && (
              <p className="max-w-48 text-center text-[11px] text-muted-foreground">
                Register a device first
              </p>
            )}
            {currentToken && (
              <button
                className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground"
                onClick={copyToken}
                title="Copy current token (for testing)"
              >
                {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
                {copied ? "Copied" : "Copy token"}
              </button>
            )}
          </div>
        </div>
        {!openSession && today?.workedMinutes != null && (
          <p className="mt-3 text-center text-xs text-muted-foreground">
            Worked {((today.workedMinutes ?? 0) / 60).toFixed(1)}h today
          </p>
        )}
      </GlassCard>

      {/* stats row */}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile icon={CalendarDays} label="Today" value={STATUS_META[today?.status ?? "absent"]?.label ?? "—"} />
        <StatTile icon={Fingerprint} label="Active devices" value={(myDevices ?? []).filter((d) => d.status === "active").length} />
        <StatTile
          icon={Plane}
          label="Leave balance"
          value={balances ? balances.reduce((a, b) => a + Math.max(0, b.quota - b.used), 0) : "—"}
          hint="days remaining"
        />
        <StatTile icon={TimerReset} label="Corrections" value={myCorrections ? myCorrections.filter((c) => c.status === "pending").length : "—"} hint="pending" />
      </div>

      <Tabs defaultValue="history" className="space-y-4">
        <TabsList className="glass flex h-auto w-full flex-wrap gap-1 rounded-xl p-1">
          <TabsTrigger value="history" className="rounded-lg">History</TabsTrigger>
          <TabsTrigger value="devices" className="rounded-lg">Devices</TabsTrigger>
          <TabsTrigger value="leave" className="rounded-lg">Leave</TabsTrigger>
          <TabsTrigger value="corrections" className="rounded-lg">Corrections</TabsTrigger>
        </TabsList>

        {/* history */}
        <TabsContent value="history">
          <GlassCard className="p-5">
            <h3 className="mb-3 flex items-center gap-2 font-semibold">
              <History className="size-4 text-primary" /> Attendance history
            </h3>
            {!history ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
            ) : history.length === 0 ? (
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
                      <tr key={s._id} className="border-b border-white/30 last:border-0">
                        <td className="py-2.5 pr-3 font-medium">{fmtDay(s.dayKey)}</td>
                        <td className="py-2.5 pr-3">{fmtTime(s.clockInAt)}</td>
                        <td className="py-2.5 pr-3">{s.clockOutAt ? fmtTime(s.clockOutAt) : "—"}</td>
                        <td className="py-2.5 pr-3">{s.workedMinutes != null ? `${(s.workedMinutes / 60).toFixed(1)}h` : "—"}</td>
                        <td className="py-2.5 pr-3">
                          <Badge variant="secondary" className={STATUS_META[s.status]?.cls ?? ""}>
                            {STATUS_META[s.status]?.label ?? s.status}
                          </Badge>
                          {s.lateMinutes > 0 && (
                            <span className="ml-1.5 text-[10px] text-amber-700">+{s.lateMinutes}m</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </GlassCard>
        </TabsContent>

        {/* devices */}
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
                      A device-bound key fingerprint is created. Keep your device secure — only HR can approve replacements.
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
            {!myDevices ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
            ) : myDevices.length === 0 ? (
              <Empty icon={Smartphone} text="No devices registered yet." />
            ) : (
              <div className="space-y-2">
                {myDevices.map((d) => {
                  const meta = DEVICE_STATUS_META[d.status];
                  return (
                    <div key={d._id} className="glass-soft flex flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="glass-inset flex size-9 items-center justify-center rounded-lg">
                          <Smartphone className="size-4 text-primary" />
                        </div>
                        <div>
                          <p className="text-sm font-semibold">{d.label} <span className="ml-1 text-xs font-normal text-muted-foreground">· {d.platform}</span></p>
                          <p className="font-mono text-[10px] text-muted-foreground">fp:{d.publicKeyFingerprint.slice(0, 16)}…</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className={meta.cls}>{meta.label}</Badge>
                        {d.status === "active" && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="glass h-7 text-xs"
                            onClick={async () => {
                              try {
                                await requestReplacement({ deviceId: d._id, reason: "Lost / replacing device" });
                                toast.success("Replacement requested — HR will review.");
                              } catch (e) {
                                toast.error(e instanceof Error ? e.message : "Failed");
                              }
                            }}
                          >
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

        {/* leave */}
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
                            {(balances ?? []).map((b) => (
                              <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
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
              {!balances ? (
                <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
              ) : (
                <div className="space-y-2.5">
                  {balances.map((b) => {
                    const remaining = Math.max(0, b.quota - b.used);
                    const pct = b.quota > 0 ? remaining / b.quota : 0;
                    return (
                      <div key={b.id} className="glass-soft rounded-xl p-3.5">
                        <div className="flex items-center justify-between text-sm">
                          <span className="font-medium">{b.name}</span>
                          <span className="text-muted-foreground">{remaining} / {b.quota} days</span>
                        </div>
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/50">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-primary/80 to-primary/50"
                            style={{ width: `${pct * 100}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </GlassCard>

            <GlassCard className="lg:col-span-2 p-5">
              <h3 className="mb-3 font-semibold">My requests</h3>
              {!myLeave ? (
                <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
              ) : myLeave.length === 0 ? (
                <Empty icon={Plane} text="No leave requests yet." />
              ) : (
                <div className="space-y-2">
                  {myLeave.map((r) => (
                    <div key={r._id} className="glass-soft flex flex-wrap items-center justify-between gap-2 rounded-xl px-4 py-3">
                      <div>
                        <p className="text-sm font-medium">
                          {r.typeName} · {r.startDate} → {r.endDate}
                        </p>
                        <p className="text-xs text-muted-foreground">{r.reason}</p>
                      </div>
                      <Badge
                        variant="secondary"
                        className={
                          r.status === "approved" ? "bg-emerald-500/15 text-emerald-700"
                          : r.status === "rejected" ? "bg-rose-500/15 text-rose-700"
                          : r.status === "cancelled" ? "bg-slate-500/15 text-slate-600"
                          : "bg-amber-500/15 text-amber-700"
                        }
                      >
                        {r.status}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </GlassCard>
          </div>
        </TabsContent>

        {/* corrections */}
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
            {!myCorrections ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
            ) : myCorrections.length === 0 ? (
              <Empty icon={TimerReset} text="No correction requests yet." />
            ) : (
              <div className="space-y-2">
                {myCorrections.map((c) => (
                  <div key={c._id} className="glass-soft rounded-xl px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-medium">{c.sessionDate}</p>
                      <Badge
                        variant="secondary"
                        className={
                          c.status === "approved" ? "bg-emerald-500/15 text-emerald-700"
                          : c.status === "rejected" ? "bg-rose-500/15 text-rose-700"
                          : "bg-amber-500/15 text-amber-700"
                        }
                      >
                        {c.status}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{c.reason}</p>
                    {c.reviewerNote && (
                      <p className="mt-1 text-xs italic text-muted-foreground">HR: {c.reviewerNote}</p>
                    )}
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
