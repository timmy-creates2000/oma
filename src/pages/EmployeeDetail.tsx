import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/AppShell";
import { GlassCard, PageHeader, Empty } from "@/components/glass";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useQuery, useMutation } from "convex/react";
import { useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import {
  ChevronLeft, Smartphone, History, Plane, UserX, ShieldCheck,
} from "lucide-react";

function fmtTime(ts: number) {
  return new Date(ts).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
}
function fmtDay(dk: string) {
  return new Date(`${dk}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric", timeZone: "UTC",
  });
}

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
  const detail = useQuery(api.employees.detail, id ? { id: id as any } : "skip");
  const deactivate = useMutation(api.employees.softDelete);

  if (!detail) {
    return (
      <AppShell title="Employee">
        <GlassCard className="p-10 text-center text-sm text-muted-foreground">Loading…</GlassCard>
      </AppShell>
    );
  }

  const { employee, department, branch, devices, recentSessions, balances } = detail;

  return (
    <AppShell title={employee.name}>
      <Button variant="ghost" size="sm" className="mb-4 -ml-2" onClick={() => navigate("/employees")}>
        <ChevronLeft className="size-4" /> All employees
      </Button>

      <PageHeader
        title={employee.name}
        subtitle={`${employee.employeeCode} · ${employee.position ?? "—"} · ${department ?? "no department"} · ${branch ?? "no branch"}`}
        actions={
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
                  Their seat is kept and history preserved (soft delete). They can be re-added later by email.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-white hover:bg-destructive/90"
                  onClick={async () => {
                    try {
                      await deactivate({ id: employee._id });
                      toast.success("Employee deactivated");
                      navigate("/employees");
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : "Failed");
                    }
                  }}
                >
                  Deactivate
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        {/* left column */}
        <div className="space-y-4">
          <GlassCard className="p-5">
            <h3 className="mb-3 font-semibold">Profile</h3>
            <dl className="space-y-2 text-sm">
              {[
                ["Email", employee.email],
                ["Role", employee.role.replace("_", " ")],
                ["Joined", employee.joinedAt ? new Date(employee.joinedAt).toLocaleDateString() : "—"],
                ["Status", employee.active ? "Active" : "Inactive"],
              ].map(([k, v]) => (
                <div key={k as string} className="flex justify-between gap-4">
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
                  const remaining = Math.max(0, b.quota - b.used);
                  return (
                    <div key={b.id} className="glass-soft rounded-xl p-3">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium">{b.typeName}</span>
                        <span className="text-muted-foreground">{remaining} / {b.quota}</span>
                      </div>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/50">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-primary/80 to-primary/50"
                          style={{ width: `${b.quota ? (remaining / b.quota) * 100 : 0}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </GlassCard>
        </div>

        {/* middle: attendance */}
        <GlassCard className="p-5 lg:col-span-2">
          <h3 className="mb-3 flex items-center gap-2 font-semibold">
            <History className="size-4 text-primary" /> Recent attendance
          </h3>
          {recentSessions.length === 0 ? (
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
                  {recentSessions.map((s) => (
                    <tr key={s._id} className="border-b border-white/30 last:border-0">
                      <td className="py-2.5 pr-3 font-medium">{fmtDay(s.dayKey)}</td>
                      <td className="py-2.5 pr-3">{fmtTime(s.clockInAt)}</td>
                      <td className="py-2.5 pr-3">{s.clockOutAt ? fmtTime(s.clockOutAt) : "—"}</td>
                      <td className="py-2.5 pr-3">{s.workedMinutes != null ? `${(s.workedMinutes / 60).toFixed(1)}h` : "—"}</td>
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
                <div key={d._id} className="glass-soft flex items-center justify-between rounded-xl px-4 py-2.5">
                  <div className="flex items-center gap-3">
                    <Smartphone className="size-4 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">{d.label} · {d.platform}</p>
                      <p className="font-mono text-[10px] text-muted-foreground">fp:{d.publicKeyFingerprint.slice(0, 14)}…</p>
                    </div>
                  </div>
                  <Badge
                    variant="secondary"
                    className={
                      d.status === "active" ? "bg-emerald-500/15 text-emerald-700"
                      : d.status === "pending_replacement" ? "bg-amber-500/15 text-amber-700"
                      : "bg-rose-500/15 text-rose-700"
                    }
                  >
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
