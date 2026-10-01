import { AppShell } from "@/components/AppShell";
import { GlassCard, PageHeader, Empty } from "@/components/glass";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { ChevronLeft, Smartphone, History, Plane, UserX, Trash2, ShieldCheck, RefreshCw } from "lucide-react";
import { supabase, fmtTime, fmtDay, err } from "@/lib/sb";
import { useWorkspace } from "@/hooks/use-workspace";

type Detail = {
  employee: {
    id: string; name: string; email: string; employee_code: string; role: string;
    position: string | null; joined_at: string | null; active: boolean;
  };
  department: string | null;
  branch: string | null;
  devices: Array<{ id: string; label: string; platform: string; status: string; public_key_fingerprint: string }>;
  sessions: Array<{
    id: string; day_key: string; clock_in_at: string; clock_out_at: string | null;
    worked_minutes: number | null; status: string; late_minutes: number;
  }>;
  balances: Array<{ id: string; used_days: number; leave_types: { name: string; annual_quota_days: number } | null }>;
};

const STATUS_META: Record<string, string> = {
  present: "bg-emerald-500/15 text-emerald-700",
  late: "bg-amber-500/15 text-amber-700",
  half_day: "bg-orange-500/15 text-orange-700",
  on_leave: "bg-sky-500/15 text-sky-700",
  absent: "bg-rose-500/15 text-rose-700",
};

export default function EmployeeDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [delLogin, setDelLogin] = useState(false);
  const { ws } = useWorkspace();
  const [detail, setDetail] = useState<Detail | null>(null);

  useEffect(() => {
    if (!ws || !id) return;
    (async () => {
      const { data: emp } = await supabase.from("employees")
        .select("id, name, email, employee_code, role, position, joined_at, active, departments(name), branches(name)")
        .eq("id", id).maybeSingle();
      if (!emp) return;
      const e = emp as unknown as {
        id: string; name: string; email: string; employee_code: string; role: string;
        position: string | null; joined_at: string | null; active: boolean;
        departments: { name: string } | null; branches: { name: string } | null;
      };
      const [dev, sess, bal] = await Promise.all([
        supabase.from("registered_devices").select("*").eq("employee_id", e.id).order("registered_at", { ascending: false }),
        supabase.from("attendance_sessions").select("*").eq("employee_id", e.id).order("clock_in_at", { ascending: false }).limit(30),
        supabase.from("leave_balances").select("*, leave_types(name, annual_quota_days)").eq("employee_id", e.id).eq("year", new Date().getFullYear()),
      ]);
      setDetail({
        employee: e,
        department: e.departments?.name ?? null,
        branch: e.branches?.name ?? null,
        devices: (dev.data ?? []) as Detail["devices"],
        sessions: (sess.data ?? []) as Detail["sessions"],
        balances: (bal.data ?? []) as Detail["balances"],
      });
    })();
  }, [ws, id]);

  if (!detail) {
    return (
      <AppShell title="Employee">
        <GlassCard className="p-10 text-center text-sm text-muted-foreground">
          <RefreshCw className="mx-auto mb-2 size-5 animate-spin" /> Loading…
        </GlassCard>
      </AppShell>
    );
  }

  const { employee, department, branch, devices, sessions, balances } = detail;

  return (
    <AppShell title={employee.name}>
      <Button variant="ghost" size="sm" className="mb-4 -ml-2" onClick={() => navigate("/employees")}>
        <ChevronLeft className="size-4" /> All employees
      </Button>

      <PageHeader
        title={employee.name}
        subtitle={`${employee.employee_code} · ${employee.position ?? "—"} · ${department ?? "no department"} · ${branch ?? "no branch"}`}
        actions={
          <div className="flex flex-wrap gap-2">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" className="glass text-destructive">
                <UserX className="size-4" /> Deactivate
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent className="glass-strong">
              <AlertDialogHeader>
                <AlertDialogTitle>Deactivate {employee.name}?</AlertDialogTitle>
                <AlertDialogDescription>
                  Their history is kept and they lose access. You can add them again later with the same email.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-white hover:bg-destructive/90"
                  onClick={async () => {
                    try {
                      const { error } = await supabase.rpc("deactivate_employee", { p_employee: employee.id });
                      if (error) throw error;
                      toast.success("Employee deactivated");
                      navigate("/employees");
                    } catch (e) {
                      toast.error(err(e));
                    }
                  }}
                >
                  Deactivate
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
            <AlertDialog onOpenChange={(o) => { if (!o) setDelLogin(false); }}>
              <AlertDialogTrigger asChild>
                <Button variant="outline" className="glass border-destructive/40 text-destructive">
                  <Trash2 className="size-4" /> Delete permanently
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent className="glass-strong">
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete {employee.name} permanently?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This removes the employee and all their attendance, leave, devices and requests from the database. It cannot be undone. You can add the same email or code again afterwards.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-1" checked={delLogin} onChange={(e) => setDelLogin(e.target.checked)} />
                  <span>Also delete their sign-in account (they will need to sign up again)</span>
                </label>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-white hover:bg-destructive/90"
                    onClick={async () => {
                      try {
                        const { error } = await supabase.rpc("delete_employee", { p_employee: employee.id, p_delete_login: delLogin });
                        if (error) throw error;
                        toast.success("Employee deleted");
                        navigate("/employees");
                      } catch (e) {
                        toast.error(err(e));
                      }
                    }}
                  >
                    Delete permanently
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4">
          <GlassCard className="p-5">
            <h3 className="mb-3 font-semibold">Profile</h3>
            <dl className="space-y-2 text-sm">
              {[
                ["Email", employee.email],
                ["Role", employee.role.replace("_", " ")],
                ["Joined", employee.joined_at ? new Date(employee.joined_at).toLocaleDateString() : "—"],
                ["Status", employee.active ? "Active" : "Inactive"],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="text-right font-medium capitalize">{v}</dd>
                </div>
              ))}
            </dl>
          </GlassCard>

          <GlassCard className="p-5">
            <h3 className="mb-3 flex items-center gap-2 font-semibold">
              <Plane className="size-4 text-primary" /> Leave balances
            </h3>
            {balances.length === 0 ? (
              <Empty icon={Plane} text="No balances yet." />
            ) : (
              <div className="space-y-2.5">
                {balances.map((b) => {
                  const quota = b.leave_types?.annual_quota_days ?? 0;
                  const remaining = Math.max(0, quota - Number(b.used_days));
                  return (
                    <div key={b.id} className="glass-soft rounded-xl p-3">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium">{b.leave_types?.name ?? "Leave"}</span>
                        <span className="text-muted-foreground">{remaining} / {quota}</span>
                      </div>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/50">
                        <div className="h-full rounded-full bg-gradient-to-r from-primary/80 to-primary/50"
                          style={{ width: `${quota ? (remaining / quota) * 100 : 0}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </GlassCard>
        </div>

        <GlassCard className="p-5 lg:col-span-2">
          <h3 className="mb-3 flex items-center gap-2 font-semibold">
            <History className="size-4 text-primary" /> Recent attendance
          </h3>
          {sessions.length === 0 ? (
            <Empty icon={History} text="No attendance records." />
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
                  {sessions.map((s) => (
                    <tr key={s.id} className="border-b border-white/30 last:border-0">
                      <td className="py-2.5 pr-3 font-medium">{fmtDay(s.day_key)}</td>
                      <td className="py-2.5 pr-3">{fmtTime(s.clock_in_at)}</td>
                      <td className="py-2.5 pr-3">{s.clock_out_at ? fmtTime(s.clock_out_at) : "—"}</td>
                      <td className="py-2.5 pr-3">{s.worked_minutes != null ? `${(s.worked_minutes / 60).toFixed(1)}h` : "—"}</td>
                      <td className="py-2.5 pr-3">
                        <Badge variant="secondary" className={STATUS_META[s.status] ?? ""}>{s.status.replace("_", " ")}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <h3 className="mb-3 mt-6 flex items-center gap-2 font-semibold">
            <Smartphone className="size-4 text-primary" /> Devices
          </h3>
          {devices.length === 0 ? (
            <Empty icon={Smartphone} text="No devices registered." />
          ) : (
            <div className="space-y-2">
              {devices.map((d) => (
                <div key={d.id} className="glass-soft flex items-center justify-between rounded-xl px-4 py-2.5">
                  <div className="flex items-center gap-3">
                    <Smartphone className="size-4 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">{d.label} · {d.platform}</p>
                      <p className="font-mono text-[10px] text-muted-foreground">fp:{d.public_key_fingerprint.slice(0, 14)}…</p>
                    </div>
                  </div>
                  <Badge variant="secondary" className={
                    d.status === "active" ? "bg-emerald-500/15 text-emerald-700"
                    : d.status === "pending_replacement" ? "bg-amber-500/15 text-amber-700"
                    : "bg-rose-500/15 text-rose-700"
                  }>
                    {d.status.replace("_", " ")}
                  </Badge>
                </div>
              ))}
            </div>
          )}
          <div className="glass-soft mt-4 flex items-start gap-2 rounded-xl p-3 text-xs text-muted-foreground">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" />
            Device fingerprints are irreversible — no biometric or private key data is ever stored.
          </div>
        </GlassCard>
      </div>
    </AppShell>
  );
}
