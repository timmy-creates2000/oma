import { AppShell } from "@/components/AppShell";
import { GlassCard, PageHeader, Empty } from "@/components/glass";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { TimerReset, Check, X } from "lucide-react";
import { supabase, fmtTime, err } from "@/lib/sb";
import { useWorkspace } from "@/hooks/use-workspace";

type Row = {
  id: string;
  session_date: string;
  requested_clock_in_at: string | null;
  requested_clock_out_at: string | null;
  reason: string;
  status: string;
  reviewer_note: string | null;
  employees: { name: string } | null;
};

export default function Corrections() {
  const { ws } = useWorkspace();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    if (!ws) return;
    setLoading(true);
    const { data } = await supabase
      .from("correction_requests")
      .select("id, session_date, requested_clock_in_at, requested_clock_out_at, reason, status, reviewer_note, employees(name)")
      .eq("company_id", ws.employee.company_id)
      .order("created_at", { ascending: false });
    setRows((data ?? []) as unknown as Row[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws]);

  const handle = async (id: string, ok: boolean) => {
    try {
      const { error } = await supabase.rpc("decide_correction", { p_request: id, p_approve: ok });
      if (error) throw error;
      toast.success(ok ? "Correction approved — session updated" : "Correction rejected");
      load();
    } catch (e) {
      toast.error(err(e));
    }
  };

  const pending = rows.filter((r) => r.status === "pending");
  const history = rows.filter((r) => r.status !== "pending");

  return (
    <AppShell title="Corrections">
      <PageHeader
        title="Attendance corrections"
        subtitle="Approved corrections rewrite the original session and are fully audited."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <GlassCard className="p-5">
          <h3 className="mb-3 font-semibold">Pending {pending.length > 0 && `(${pending.length})`}</h3>
          {loading ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
          ) : pending.length === 0 ? (
            <Empty icon={TimerReset} text="No pending corrections." />
          ) : (
            <div className="space-y-3">
              {pending.map((r) => (
                <div key={r.id} className="glass-soft rounded-xl p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold">{r.employees?.name ?? "Unknown"}</p>
                      <p className="text-xs text-muted-foreground">
                        {r.session_date}
                        {r.requested_clock_in_at ? ` · in ${fmtTime(r.requested_clock_in_at)}` : ""}
                        {r.requested_clock_out_at ? ` · out ${fmtTime(r.requested_clock_out_at)}` : ""}
                      </p>
                    </div>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">“{r.reason}”</p>
                  <div className="mt-3 flex gap-2">
                    <Button size="sm" className="h-8" onClick={() => handle(r.id, true)}>
                      <Check className="size-4" /> Approve
                    </Button>
                    <Button size="sm" variant="outline" className="glass h-8 text-destructive" onClick={() => handle(r.id, false)}>
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
              {history.map((r) => (
                <div key={r.id} className="glass-soft flex items-center justify-between rounded-xl px-4 py-3">
                  <div>
                    <p className="text-sm font-medium">{r.employees?.name ?? "Unknown"} · {r.session_date}</p>
                    {r.reviewer_note && <p className="text-xs italic text-muted-foreground">“{r.reviewer_note}”</p>}
                  </div>
                  <Badge variant="secondary" className={r.status === "approved" ? "bg-emerald-500/15 text-emerald-700" : "bg-rose-500/15 text-rose-700"}>
                    {r.status}
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
