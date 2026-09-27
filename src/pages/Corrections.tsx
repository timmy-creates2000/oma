import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/AppShell";
import { GlassCard, PageHeader, Empty } from "@/components/glass";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useQuery, useMutation } from "convex/react";
import { toast } from "sonner";
import { TimerReset, Check, X } from "lucide-react";

function fmtTime(ts?: number) {
  if (!ts) return "—";
  return new Date(ts).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
}

export default function Corrections() {
  const corrections = useQuery(api.attendance.listCorrections, {});
  const decide = useMutation(api.attendance.decideCorrection);

  const pending = (corrections ?? []).filter((c) => c.request.status === "pending");
  const history = (corrections ?? []).filter((c) => c.request.status !== "pending");

  const handle = async (id: any, ok: boolean) => {
    try {
      await decide({ id, approve: ok });
      toast.success(ok ? "Correction approved — session updated" : "Correction rejected");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  };

  return (
    <AppShell title="Corrections">
      <PageHeader
        title="Attendance corrections"
        subtitle="Approved corrections rewrite the original session and are fully audited."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <GlassCard className="p-5">
          <h3 className="mb-3 font-semibold">Pending {pending.length > 0 && `(${pending.length})`}</h3>
          {!corrections ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
          ) : pending.length === 0 ? (
            <Empty icon={TimerReset} text="No pending corrections." />
          ) : (
            <div className="space-y-3">
              {pending.map(({ request, employee }) => (
                <div key={request._id} className="glass-soft rounded-xl p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold">{employee?.name ?? "Unknown"}</p>
                      <p className="text-xs text-muted-foreground">
                        {request.sessionDate}
                        {request.requestedClockInAt ? ` · in ${fmtTime(request.requestedClockInAt)}` : ""}
                        {request.requestedClockOutAt ? ` · out ${fmtTime(request.requestedClockOutAt)}` : ""}
                      </p>
                    </div>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">“{request.reason}”</p>
                  <div className="mt-3 flex gap-2">
                    <Button size="sm" className="h-8" onClick={() => handle(request._id, true)}>
                      <Check className="size-4" /> Approve
                    </Button>
                    <Button size="sm" variant="outline" className="glass h-8 text-destructive" onClick={() => handle(request._id, false)}>
                      <X className="size-4" /> Reject
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </GlassCard>

        <GlassCard className="p-5">
          <h3 className="mb-3 font-semibold">History</h3>
          {history.length === 0 ? (
            <Empty icon={TimerReset} text="No reviewed corrections yet." />
          ) : (
            <div className="space-y-2">
              {history.map(({ request, employee }) => (
                <div key={request._id} className="glass-soft flex items-center justify-between rounded-xl px-4 py-3">
                  <div>
                    <p className="text-sm font-medium">{employee?.name ?? "Unknown"} · {request.sessionDate}</p>
                    {request.reviewerNote && (
                      <p className="text-xs italic text-muted-foreground">“{request.reviewerNote}”</p>
                    )}
                  </div>
                  <Badge
                    variant="secondary"
                    className={request.status === "approved" ? "bg-emerald-500/15 text-emerald-700" : "bg-rose-500/15 text-rose-700"}
                  >
                    {request.status}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </GlassCard>
      </div>
    </AppShell>
  );
}
