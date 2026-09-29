import { AppShell } from "@/components/AppShell";
import { GlassCard, PageHeader, Empty } from "@/components/glass";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader,
  DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { TimerReset, Check, X, LogOut as LogOutIcon } from "lucide-react";
import { supabase, fmtTime, err } from "@/lib/sb";
import { useWorkspace } from "@/hooks/use-workspace";

type CorrRow = {
  id: string;
  session_date: string;
  requested_clock_in_at: string | null;
  requested_clock_out_at: string | null;
  reason: string;
  status: string;
  reviewer_note: string | null;
  employees: { name: string } | null;
};

type EcoRow = {
  id: string;
  reason: string;
  status: string;
  reviewer_note: string | null;
  created_at: string;
  employees: { name: string; employee_code: string } | null;
  attendance_sessions: { clock_in_at: string } | null;
};

export default function Corrections() {
  const { ws } = useWorkspace();
  const [rows, setRows]       = useState<CorrRow[]>([]);
  const [ecoRows, setEcoRows] = useState<EcoRow[]>([]);
  const [loading, setLoading] = useState(true);

  // reject-with-note dialog state
  const [rejectId,   setRejectId]   = useState<string | null>(null);
  const [rejectType, setRejectType] = useState<"correction" | "eco">("correction");
  const [rejectNote, setRejectNote] = useState("");

  const load = async () => {
    if (!ws) return;
    setLoading(true);
    const [corrRes, ecoRes] = await Promise.all([
      supabase
        .from("correction_requests")
        .select("id, session_date, requested_clock_in_at, requested_clock_out_at, reason, status, reviewer_note, employees(name)")
        .eq("company_id", ws.employee.company_id)
        .order("created_at", { ascending: false }),
      supabase
        .from("early_clockout_requests")
        .select("id, reason, status, reviewer_note, created_at, employees(name, employee_code), attendance_sessions(clock_in_at)")
        .eq("company_id", ws.employee.company_id)
        .order("created_at", { ascending: false }),
    ]);
    setRows((corrRes.data ?? []) as unknown as CorrRow[]);
    setEcoRows((ecoRes.data ?? []) as unknown as EcoRow[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws]);

  // Realtime — refresh when any correction or early clock-out request changes
  useEffect(() => {
    if (!ws) return;
    const cid = ws.employee.company_id;
    const channel = supabase
      .channel(`corrections-${cid}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "correction_requests", filter: `company_id=eq.${cid}` },
        () => load(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "early_clockout_requests", filter: `company_id=eq.${cid}` },
        () => load(),
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws]);

  const handleCorrection = async (id: string, ok: boolean, note?: string) => {
    try {
      const { error } = await supabase.rpc("decide_correction", {
        p_request: id, p_approve: ok, p_note: note ?? null,
      });
      if (error) throw error;
      toast.success(ok ? "Correction approved — session updated" : "Correction rejected");
      load();
    } catch (e) { toast.error(err(e)); }
  };

  const handleEco = async (id: string, ok: boolean, note?: string) => {
    try {
      const { error } = await supabase.rpc("decide_early_clockout", {
        p_request: id, p_approve: ok, p_note: note ?? null,
      });
      if (error) throw error;
      toast.success(ok ? "Early clock-out approved — employee clocked out" : "Request rejected");
      load();
    } catch (e) { toast.error(err(e)); }
  };

  const openReject = (id: string, type: "correction" | "eco") => {
    setRejectId(id);
    setRejectType(type);
    setRejectNote("");
  };

  const submitReject = async () => {
    if (!rejectId) return;
    if (rejectType === "correction") await handleCorrection(rejectId, false, rejectNote);
    else await handleEco(rejectId, false, rejectNote);
    setRejectId(null);
  };

  const pendingCorr = rows.filter((r) => r.status === "pending");
  const historyCorr = rows.filter((r) => r.status !== "pending");
  const pendingEco  = ecoRows.filter((r) => r.status === "pending");
  const historyEco  = ecoRows.filter((r) => r.status !== "pending");

  const pendingTotal = pendingCorr.length + pendingEco.length;

  return (
    <AppShell title="Corrections">
      <PageHeader
        title="Attendance corrections"
        subtitle="Approved corrections rewrite the original session and are fully audited."
      />

      <Tabs defaultValue="corrections" className="space-y-4">
        <TabsList className="glass flex h-auto w-full gap-1 rounded-xl p-1">
          <TabsTrigger value="corrections" className="relative rounded-lg">
            Corrections
            {pendingCorr.length > 0 && (
              <span className="ml-1.5 inline-flex size-4 items-center justify-center rounded-full bg-amber-500 text-[10px] font-bold text-white">
                {pendingCorr.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="early-clockout" className="relative rounded-lg">
            Early clock-out
            {pendingEco.length > 0 && (
              <span className="ml-1.5 inline-flex size-4 items-center justify-center rounded-full bg-amber-500 text-[10px] font-bold text-white">
                {pendingEco.length}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ── Attendance corrections tab ── */}
        <TabsContent value="corrections">
          <div className="grid gap-4 lg:grid-cols-2">
            <GlassCard className="p-5">
              <h3 className="mb-3 font-semibold">
                Pending {pendingCorr.length > 0 && `(${pendingCorr.length})`}
              </h3>
              {loading ? (
                <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
              ) : pendingCorr.length === 0 ? (
                <Empty icon={TimerReset} text="No pending corrections." />
              ) : (
                <div className="space-y-3">
                  {pendingCorr.map((r) => (
                    <div key={r.id} className="glass-soft rounded-xl p-4">
                      <div>
                        <p className="text-sm font-semibold">{r.employees?.name ?? "Unknown"}</p>
                        <p className="text-xs text-muted-foreground">
                          {r.session_date}
                          {r.requested_clock_in_at ? ` · in ${fmtTime(r.requested_clock_in_at)}` : ""}
                          {r.requested_clock_out_at ? ` · out ${fmtTime(r.requested_clock_out_at)}` : ""}
                        </p>
                      </div>
                      <p className="mt-2 text-sm text-muted-foreground">"{r.reason}"</p>
                      <div className="mt-3 flex gap-2">
                        <Button size="sm" className="h-8" onClick={() => handleCorrection(r.id, true)}>
                          <Check className="size-4" /> Approve
                        </Button>
                        <Button size="sm" variant="outline" className="glass h-8 text-destructive"
                          onClick={() => openReject(r.id, "correction")}>
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
              {historyCorr.length === 0 ? (
                <Empty icon={TimerReset} text="No reviewed corrections yet." />
              ) : (
                <div className="space-y-2">
                  {historyCorr.map((r) => (
                    <div key={r.id} className="glass-soft flex items-center justify-between rounded-xl px-4 py-3">
                      <div>
                        <p className="text-sm font-medium">
                          {r.employees?.name ?? "Unknown"} · {r.session_date}
                        </p>
                        {r.reviewer_note && (
                          <p className="text-xs italic text-muted-foreground">"{r.reviewer_note}"</p>
                        )}
                      </div>
                      <Badge variant="secondary" className={
                        r.status === "approved"
                          ? "bg-emerald-500/15 text-emerald-700"
                          : "bg-rose-500/15 text-rose-700"
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

        {/* ── Early clock-out tab ── */}
        <TabsContent value="early-clockout">
          <div className="grid gap-4 lg:grid-cols-2">
            <GlassCard className="p-5">
              <h3 className="mb-3 font-semibold">
                Pending {pendingEco.length > 0 && `(${pendingEco.length})`}
              </h3>
              {loading ? (
                <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
              ) : pendingEco.length === 0 ? (
                <Empty icon={LogOutIcon} text="No pending early clock-out requests." />
              ) : (
                <div className="space-y-3">
                  {pendingEco.map((r) => (
                    <div key={r.id} className="glass-soft rounded-xl p-4">
                      <div>
                        <p className="text-sm font-semibold">
                          {r.employees?.name ?? "Unknown"}
                          <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                            {r.employees?.employee_code}
                          </span>
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Clocked in at {r.attendance_sessions ? fmtTime(r.attendance_sessions.clock_in_at) : "—"}
                          {" · "}Requested {new Date(r.created_at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
                        </p>
                      </div>
                      <p className="mt-2 text-sm text-muted-foreground">"{r.reason}"</p>
                      <div className="mt-3 flex gap-2">
                        <Button size="sm" className="h-8" onClick={() => handleEco(r.id, true)}>
                          <Check className="size-4" /> Approve &amp; clock out
                        </Button>
                        <Button size="sm" variant="outline" className="glass h-8 text-destructive"
                          onClick={() => openReject(r.id, "eco")}>
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
              {historyEco.length === 0 ? (
                <Empty icon={LogOutIcon} text="No reviewed early clock-out requests yet." />
              ) : (
                <div className="space-y-2">
                  {historyEco.map((r) => (
                    <div key={r.id} className="glass-soft flex items-center justify-between rounded-xl px-4 py-3">
                      <div>
                        <p className="text-sm font-medium">
                          {r.employees?.name ?? "Unknown"} · {new Date(r.created_at).toLocaleDateString()}
                        </p>
                        {r.reviewer_note && (
                          <p className="text-xs italic text-muted-foreground">"{r.reviewer_note}"</p>
                        )}
                      </div>
                      <Badge variant="secondary" className={
                        r.status === "approved"
                          ? "bg-emerald-500/15 text-emerald-700"
                          : "bg-rose-500/15 text-rose-700"
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
      </Tabs>

      {/* Reject with note dialog — shared for both types */}
      <Dialog open={!!rejectId} onOpenChange={(open) => { if (!open) setRejectId(null); }}>
        <DialogContent className="glass-strong">
          <DialogHeader>
            <DialogTitle>Reject request</DialogTitle>
            <DialogDescription>
              Optionally provide a note so the employee knows why.
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label>Note (optional)</Label>
            <Textarea
              className="mt-1.5"
              rows={3}
              placeholder="Reason for rejection…"
              value={rejectNote}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setRejectNote(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" className="glass" onClick={() => setRejectId(null)}>Cancel</Button>
            <Button variant="destructive" onClick={submitReject}>Confirm rejection</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
