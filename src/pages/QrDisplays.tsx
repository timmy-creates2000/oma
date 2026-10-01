import { AppShell } from "@/components/AppShell";
import { GlassCard, PageHeader, Empty } from "@/components/glass";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { QrCode, Plus, Trash2, ExternalLink } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { supabase, err } from "@/lib/sb";
import { useWorkspace } from "@/hooks/use-workspace";

type Row = {
  id: string;
  label: string;
  active: boolean;
  branch_id: string | null;
  branches: { name: string } | null;
};

export default function QrDisplays() {
  const { ws } = useWorkspace();
  const [rows, setRows] = useState<Row[]>([]);
  const [branches, setBranches] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    if (!ws) return;
    const cid = ws.employee.company_id;
    const [d, b] = await Promise.all([
      supabase.from("qr_displays").select("id, label, active, branch_id, branches(name)").eq("company_id", cid).order("created_at", { ascending: false }),
      supabase.from("branches").select("id, name").eq("company_id", cid).order("name"),
    ]);
    setRows((d.data ?? []) as unknown as Row[]);
    setBranches((b.data ?? []) as Array<{ id: string; name: string }>);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws]);

  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [branchId, setBranchId] = useState("none");

  const handleCreate = async () => {
    try {
      const { error } = await supabase.rpc("create_qr_display", {
        p_label: label, p_branch: branchId === "none" ? null : branchId,
      });
      if (error) throw error;
      toast.success("QR display created");
      setOpen(false);
      setLabel("");
      load();
    } catch (e) {
      toast.error(err(e));
    }
  };

  return (
    <AppShell title="QR displays">
      <PageHeader
        title="QR displays"
        subtitle="Kiosk screens that show a rotating, single-use QR code at your entrances."
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm"><Plus className="size-4" /> New display</Button>
            </DialogTrigger>
            <DialogContent className="glass-strong max-w-sm">
              <DialogHeader><DialogTitle>New QR display</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label>Label</Label>
                  <Input className="mt-1.5" placeholder="Lobby kiosk" value={label} onChange={(e) => setLabel(e.target.value)} />
                </div>
                <div>
                  <Label>Branch</Label>
                  <Select value={branchId} onValueChange={setBranchId}>
                    <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">All branches</SelectItem>
                      {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" className="glass" onClick={() => setOpen(false)}>Cancel</Button>
                <Button onClick={handleCreate} disabled={!label.trim()}>Create</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      {loading ? (
        <GlassCard className="p-10 text-center text-sm text-muted-foreground">Loading…</GlassCard>
      ) : rows.length === 0 ? (
        <GlassCard className="p-5"><Empty icon={QrCode} text="No QR displays yet — create one to start scanning." /></GlassCard>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((d) => (
            <GlassCard key={d.id} className="p-5">
              <div className="flex items-start justify-between gap-2">
                <div className="glass-inset flex size-10 items-center justify-center rounded-xl">
                  <QrCode className="size-5 text-primary" />
                </div>
                <Badge variant="secondary" className={d.active ? "bg-emerald-500/15 text-emerald-700" : "bg-slate-500/15 text-slate-600"}>
                  {d.active ? "active" : "inactive"}
                </Badge>
              </div>
              <h3 className="mt-3 font-semibold">{d.label}</h3>
              <p className="text-xs text-muted-foreground">{d.branches?.name ?? "All branches"}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {d.active && (
                  <Button asChild size="sm" variant="outline" className="glass h-8 text-xs">
                    <Link to={`/kiosk?display=${d.id}`}><ExternalLink className="size-3.5" /> Open kiosk</Link>
                  </Button>
                )}
                <label className="flex items-center gap-2 rounded-lg border bg-white/40 px-3 py-1 text-xs font-medium">
                  <Switch
                    checked={d.active}
                    onCheckedChange={async () => {
                      try {
                        const { error } = await supabase.rpc("toggle_qr_display", { p_id: d.id });
                        if (error) throw error;
                        toast.success(d.active ? "QR turned off. Nobody can scan until you turn it on." : "QR turned on");
                        load();
                      } catch (e) { toast.error(err(e)); }
                    }}
                    aria-label="Turn this QR on or off"
                  />
                  {d.active ? "QR on" : "QR off"}
                </label>
                <Button size="sm" variant="outline" className="glass h-8 text-xs text-destructive"
                  onClick={async () => {
                    if (!window.confirm(`Delete the QR display "${d.label}"? This cannot be undone.`)) return;
                    try {
                      const { error } = await supabase.rpc("delete_qr_display", { p_id: d.id });
                      if (error) throw error;
                      toast.success("Display removed");
                      load();
                    } catch (e) { toast.error(err(e)); }
                  }}>
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </GlassCard>
          ))}
        </div>
      )}
    </AppShell>
  );
}
