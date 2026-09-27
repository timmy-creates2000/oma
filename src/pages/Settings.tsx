import { AppShell } from "@/components/AppShell";
import { GlassCard, PageHeader } from "@/components/glass";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Building2, Save, Plus, Trash2, CalendarOff, Plane, ShieldCheck } from "lucide-react";
import { supabase, err } from "@/lib/sb";
import { useWorkspace } from "@/hooks/use-workspace";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function toHM(mins: number) {
  return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
}
function toMinutes(t: string) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

type Holiday = { id: string; date: string; name: string };
type LeaveTypeRow = { id: string; name: string; annual_quota_days: number; paid: boolean };

export default function Settings() {
  const { ws, refresh } = useWorkspace();
  const [name, setName] = useState("");
  const [industry, setIndustry] = useState("");
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("17:30");
  const [grace, setGrace] = useState("10");
  const [workDays, setWorkDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [qrRotation, setQrRotation] = useState("30");
  const [requireGeo, setRequireGeo] = useState(false);
  const [autoOut, setAutoOut] = useState("14");
  const [retention, setRetention] = useState("730");

  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [leaveTypes, setLeaveTypes] = useState<LeaveTypeRow[]>([]);
  const [holDate, setHolDate] = useState("");
  const [holName, setHolName] = useState("");
  const [ltName, setLtName] = useState("");
  const [ltQuota, setLtQuota] = useState("12");
  const [ltPaid, setLtPaid] = useState(true);

  useEffect(() => {
    if (!ws) return;
    const c = ws.company;
    setName(c.name);
    setIndustry(c.industry ?? "");
    setStart(toHM(c.start_minute));
    setEnd(toHM(c.end_minute));
    setGrace(String(c.late_grace_minutes));
    setWorkDays([...(c.work_days ?? [1, 2, 3, 4, 5])]);
    setQrRotation(String(ws.settings.qr_rotation_seconds));
    setRequireGeo(ws.settings.require_geo);
    setAutoOut(String(ws.settings.auto_clock_out_hours));
    setRetention(String(ws.settings.retention_days));

    const cid = ws.employee.company_id;
    (async () => {
      const [h, lt] = await Promise.all([
        supabase.from("public_holidays").select("*").eq("company_id", cid).order("date"),
        supabase.from("leave_types").select("*").eq("company_id", cid).order("name"),
      ]);
      setHolidays((h.data ?? []) as Holiday[]);
      setLeaveTypes((lt.data ?? []) as LeaveTypeRow[]);
    })();
  }, [ws]);

  const handleSave = async () => {
    try {
      const { error } = await supabase.rpc("update_settings", {
        p_name: name,
        p_industry: industry || null,
        p_start: toMinutes(start),
        p_end: toMinutes(end),
        p_grace: Number(grace) || 0,
        p_work_days: workDays,
        p_qr_rotation: Math.min(120, Math.max(10, Number(qrRotation) || 30)),
        p_require_geo: requireGeo,
        p_auto_out: Number(autoOut) || 14,
        p_retention: Number(retention) || 730,
      });
      if (error) throw error;
      toast.success("Settings saved");
      refresh();
    } catch (e) {
      toast.error(err(e));
    }
  };

  if (!ws) {
    return (
      <AppShell title="Settings">
        <GlassCard className="p-10 text-center text-sm text-muted-foreground">Loading…</GlassCard>
      </AppShell>
    );
  }

  return (
    <AppShell title="Settings">
      <PageHeader
        title="Company settings"
        subtitle="Working hours drive late/overtime math; QR and geo settings drive the scan flow."
        actions={<Button onClick={handleSave}><Save className="size-4" /> Save changes</Button>}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <GlassCard className="p-5">
          <h3 className="mb-4 flex items-center gap-2 font-semibold">
            <Building2 className="size-4 text-primary" /> Company & working hours
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label>Company name</Label>
              <Input className="mt-1.5" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <Label>Industry</Label>
              <Input className="mt-1.5" value={industry} onChange={(e) => setIndustry(e.target.value)} />
            </div>
            <div>
              <Label>Work starts</Label>
              <Input type="time" className="mt-1.5" value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div>
              <Label>Work ends</Label>
              <Input type="time" className="mt-1.5" value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>
            <div>
              <Label>Late grace (min)</Label>
              <Input type="number" className="mt-1.5" value={grace} onChange={(e) => setGrace(e.target.value)} />
            </div>
          </div>
          <div className="mt-3">
            <Label>Working days</Label>
            <div className="mt-1.5 flex gap-1.5">
              {DAYS.map((d, i) => (
                <button
                  key={d} type="button"
                  onClick={() => setWorkDays((p) => (p.includes(i) ? p.filter((x) => x !== i) : [...p, i]))}
                  className={`h-9 flex-1 rounded-lg text-xs font-semibold transition-all ${
                    workDays.includes(i)
                      ? "bg-primary text-primary-foreground shadow-md shadow-primary/25"
                      : "glass-soft text-muted-foreground"
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>
        </GlassCard>

        <GlassCard className="p-5">
          <h3 className="mb-4 flex items-center gap-2 font-semibold">
            <ShieldCheck className="size-4 text-primary" /> Attendance engine
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>QR rotation (seconds)</Label>
              <Input type="number" min={10} max={120} className="mt-1.5" value={qrRotation} onChange={(e) => setQrRotation(e.target.value)} />
              <p className="mt-1 text-[11px] text-muted-foreground">How often each kiosk mints a new token (10–120s).</p>
            </div>
            <div>
              <Label>Auto clock-out (hours)</Label>
              <Input type="number" min={4} max={24} className="mt-1.5" value={autoOut} onChange={(e) => setAutoOut(e.target.value)} />
              <p className="mt-1 text-[11px] text-muted-foreground">Open sessions older than this are auto-closed as half-day.</p>
            </div>
            <div>
              <Label>Data retention (days)</Label>
              <Input type="number" className="mt-1.5" value={retention} onChange={(e) => setRetention(e.target.value)} />
              <p className="mt-1 text-[11px] text-muted-foreground">Configurable retention policy for privacy compliance.</p>
            </div>
            <div className="glass-soft flex items-center justify-between rounded-xl px-4 py-3.5 sm:col-span-2">
              <div>
                <p className="text-sm font-medium">Require GPS geofence on scan</p>
                <p className="text-xs text-muted-foreground">Validates distance to the branch office at clock-in/out.</p>
              </div>
              <Switch checked={requireGeo} onCheckedChange={setRequireGeo} />
            </div>
          </div>
        </GlassCard>

        <GlassCard className="p-5">
          <h3 className="mb-4 flex items-center gap-2 font-semibold">
            <CalendarOff className="size-4 text-primary" /> Public holidays
          </h3>
          <div className="mb-3 flex gap-2">
            <Input type="date" className="w-40" value={holDate} onChange={(e) => setHolDate(e.target.value)} />
            <Input placeholder="Holiday name" className="flex-1" value={holName} onChange={(e) => setHolName(e.target.value)} />
            <Button size="sm" className="shrink-0 px-3"
              disabled={!holDate || !holName}
              onClick={async () => {
                try {
                  const { error } = await supabase.rpc("add_holiday", { p_date: holDate, p_name: holName });
                  if (error) throw error;
                  setHolDate(""); setHolName("");
                  toast.success("Holiday added");
                  const { data } = await supabase.from("public_holidays").select("*").eq("company_id", ws.employee.company_id).order("date");
                  setHolidays((data ?? []) as Holiday[]);
                } catch (e) { toast.error(err(e)); }
              }}>
              <Plus className="size-4" />
            </Button>
          </div>
          {holidays.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">No holidays configured.</p>
          ) : (
            <div className="space-y-2">
              {holidays.map((h) => (
                <div key={h.id} className="glass-soft flex items-center justify-between rounded-xl px-4 py-2.5 text-sm">
                  <span><b className="mr-2">{h.date}</b>{h.name}</span>
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                    onClick={async () => {
                      try {
                        await supabase.rpc("remove_holiday", { p_id: h.id });
                        setHolidays((prev) => prev.filter((x) => x.id !== h.id));
                      } catch (e) { toast.error(err(e)); }
                    }}>
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </GlassCard>

        <GlassCard className="p-5">
          <h3 className="mb-4 flex items-center gap-2 font-semibold">
            <Plane className="size-4 text-primary" /> Leave types
          </h3>
          <div className="mb-3 flex flex-wrap gap-2">
            <Input placeholder="Name" className="w-36" value={ltName} onChange={(e) => setLtName(e.target.value)} />
            <Input type="number" placeholder="Quota" className="w-24" value={ltQuota} onChange={(e) => setLtQuota(e.target.value)} />
            <label className="glass-soft flex items-center gap-2 rounded-lg px-3 text-sm">
              <input type="checkbox" checked={ltPaid} onChange={(e) => setLtPaid(e.target.checked)} />
              Paid
            </label>
            <Button size="sm" className="px-3"
              disabled={!ltName.trim()}
              onClick={async () => {
                try {
                  const { error } = await supabase.rpc("add_leave_type", { p_name: ltName, p_quota: Number(ltQuota) || 0, p_paid: ltPaid });
                  if (error) throw error;
                  setLtName(""); setLtQuota("12");
                  toast.success("Leave type added");
                  const { data } = await supabase.from("leave_types").select("*").eq("company_id", ws.employee.company_id).order("name");
                  setLeaveTypes((data ?? []) as LeaveTypeRow[]);
                } catch (e) { toast.error(err(e)); }
              }}>
              <Plus className="size-4" />
            </Button>
          </div>
          <div className="space-y-2">
            {leaveTypes.map((t) => (
              <div key={t.id} className="glass-soft flex items-center justify-between rounded-xl px-4 py-2.5 text-sm">
                <span className="font-medium">{t.name}</span>
                <span className="text-muted-foreground">{t.annual_quota_days} days · {t.paid ? "paid" : "unpaid"}</span>
              </div>
            ))}
          </div>
        </GlassCard>
      </div>
    </AppShell>
  );
}
