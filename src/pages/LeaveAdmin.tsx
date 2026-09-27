import { AppShell } from "@/components/AppShell";
import { GlassCard, PageHeader, Empty } from "@/components/glass";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CalendarDays, Check, X, CalendarRange } from "lucide-react";
import { supabase, err } from "@/lib/sb";
import { useWorkspace } from "@/hooks/use-workspace";

type Row = {
  id: string;
  start_date: string;
  end_date: string;
  reason: string;
  status: string;
  decision_note: string | null;
  leave_types: { name: string } | null;
  employees: { name: string; employee_code: string } | null;
};

export default function LeaveAdmin() {
  const { ws } = useWorkspace();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [approve, setApprove] = useState(true);
  const [note, setNote] = useState("");
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));

  const load = async () => {
    if (!ws) return;
    setLoading(true);
    const { data } = await supabase
      .from("leave_requests")
      .select("id, start_date, end_date, reason, status, decision_note, leave_types(name), employees(name, employee_code)")
      .eq("company_id", ws.employee.company_id)
      .order("created_at", { ascending: false });
    setRows((data ?? []) as unknown as Row[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws]);

  const submit = async (id: string, ok: boolean, noteText?: string) => {
    try {
      const { error } = await supabase.rpc("decide_leave", { p_request: id, p_approve: ok, p_note: noteText ?? null });
      if (error) throw error;
      toast.success(ok ? "Leave approved" : "Leave rejected");
      setNoteFor(null);
      setNote("");
      load();
    } catch (e) {
      toast.error(err(e));
    }
  };

  const pending = rows.filter((r) => r.status === "pending");
  const decided = rows.filter((r) => r.status !== "pending");

  // calendar rows for the selected month
  const monthRows = rows.filter((r) => {
    const m = month + "-";
    return r.start_date.startsWith(m) || r.end_date.startsWith(m) || (r.start_date <= month + "-31" && r.end_date >= month + "-01");
  });

  return (
    <AppShell title="Leave">
      <PageHeader
        title="Leave management"
        subtitle="Approve or reject requests — balances and attendance update automatically."
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <GlassCard className="p-5">
            <h3 className="mb-3 font-semibold">Pending requests {pending.length > 0 && `(${pending.length})`}</h3>
            {loading ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
            ) : pending.length === 0 ? (
              <Empty icon={CalendarDays} text="No pending leave requests." />
            ) : (
              <div className="space-y-2.5">
                {pending.map((r) => (
                  <div key={r.id} className="glass-soft rounded-xl p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold">
                          {r.employees?.name ?? "Unknown"}
                          <span className="ml-2 text-xs font-normal text-muted-foreground">{r.employees?.employee_code}</span>
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {r.leave_types?.name ?? "Leave"} · {r.start_date} → {r.end_date} · {r.reason}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" className="h-8" onClick={() => { setApprove(true); setNoteFor(r.id); }}>
                          <Check className="size-4" /> Approve
                        </Button>
                        <Button size="sm" variant="outline" className="glass h-8 text-destructive" onClick={() => { setApprove(false); setNoteFor(r.id); }}>
                          <X className="size-4" /> Reject
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </GlassCard>

          <GlassCard className="p-5">
            <h3 className="mb-3 font-semibold">History</h3>
            {decided.length === 0 ? (
              <Empty icon={CalendarDays} text="No decided requests yet." />
            ) : (
              <div className="space-y-2">
                {decided.slice(0, 20).map((r) => (
                  <div key={r.id} className="glass-soft flex flex-wrap items-center justify-between gap-2 rounded-xl px-4 py-3">
                    <div>
                      <p className="text-sm font-medium">{r.employees?.name ?? "Unknown"} · {r.leave_types?.name ?? "Leave"}</p>
                      <p className="text-xs text-muted-foreground">{r.start_date} → {r.end_date}</p>
                    </div>
                    <Badge variant="secondary" className={
                      r.status === "approved" ? "bg-emerald-500/15 text-emerald-700"
                      : r.status === "rejected" ? "bg-rose-500/15 text-rose-700"
                      : "bg-slate-500/15 text-slate-600"
                    }>
                      {r.status}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </GlassCard>
        </div>

        <GlassCard className="p-5">
          <h3 className="mb-3 flex items-center gap-2 font-semibold">
            <CalendarRange className="size-4 text-primary" /> Leave calendar
          </h3>
          <input
            type="month"
            className="glass-soft w-full rounded-xl px-3 py-2 text-sm outline-none"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          />
          {monthRows.length === 0 ? (
            <Empty icon={CalendarRange} text="No leave this month." />
          ) : (
            <div className="mt-3 space-y-2">
              {monthRows.map((c) => (
                <div key={c.id} className="glass-soft rounded-xl px-3.5 py-2.5">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium">{c.employees?.name ?? "Unknown"}</p>
                    <Badge variant="secondary" className={
                      c.status === "approved" ? "bg-emerald-500/15 text-emerald-700"
                      : c.status === "rejected" ? "bg-rose-500/15 text-rose-700"
                      : c.status === "cancelled" ? "bg-slate-500/15 text-slate-600"
                      : "bg-amber-500/15 text-amber-700"
                    }>
                      {c.status}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{c.start_date} → {c.end_date}</p>
                </div>
              ))}
            </div>
          )}
        </GlassCard>
      </div>

      <Dialog open={!!noteFor} onOpenChange={(o) => !o && setNoteFor(null)}>
        <DialogContent className="glass-strong max-w-sm">
          <DialogHeader><DialogTitle>{approve ? "Approve" : "Reject"} request</DialogTitle></DialogHeader>
          <Textarea rows={3} placeholder={approve ? "Optional note" : "Reason (recommended)"} value={note} onChange={(e) => setNote(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" className="glass" onClick={() => setNoteFor(null)}>Cancel</Button>
            <Button
              onClick={() => noteFor && submit(noteFor, approve, note || undefined)}
              className={approve ? "" : "bg-destructive text-white hover:bg-destructive/90"}
            >
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
