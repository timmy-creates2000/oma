import { api } from "@/convex/_generated/api";
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
import { useQuery, useMutation } from "convex/react";
import { useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { QrCode, Plus, Power, Trash2, ExternalLink } from "lucide-react";

export default function QrDisplays() {
  const displays = useQuery(api.qrDisplays.list, {});
  const branches = useQuery(api.employees.listBranches, {});
  const create = useMutation(api.qrDisplays.create);
  const toggle = useMutation(api.qrDisplays.toggleActive);
  const remove = useMutation(api.qrDisplays.remove);

  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [branchId, setBranchId] = useState("none");

  const handleCreate = async () => {
    try {
      await create({ label, branchId: branchId === "none" ? undefined : (branchId as any) });
      toast.success("QR display created");
      setOpen(false);
      setLabel("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
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
              <DialogHeader>
                <DialogTitle>New QR display</DialogTitle>
              </DialogHeader>
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
                      {(branches ?? []).map((b) => (
                        <SelectItem key={b._id} value={b._id}>{b.name}</SelectItem>
                      ))}
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

      {!displays ? (
        <GlassCard className="p-10 text-center text-sm text-muted-foreground">Loading…</GlassCard>
      ) : displays.length === 0 ? (
        <GlassCard className="p-5"><Empty icon={QrCode} text="No QR displays yet — create one to start scanning." /></GlassCard>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {displays.map((d) => (
            <GlassCard key={d._id} className="p-5">
              <div className="flex items-start justify-between gap-2">
                <div className="glass-inset flex size-10 items-center justify-center rounded-xl">
                  <QrCode className="size-5 text-primary" />
                </div>
                <Badge
                  variant="secondary"
                  className={d.active ? "bg-emerald-500/15 text-emerald-700" : "bg-slate-500/15 text-slate-600"}
                >
                  {d.active ? "active" : "inactive"}
                </Badge>
              </div>
              <h3 className="mt-3 font-semibold">{d.label}</h3>
              <p className="text-xs text-muted-foreground">{d.branchName}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {d.active ? (
                  <Button asChild size="sm" variant="outline" className="glass h-8 text-xs">
                    <Link to="/kiosk"><ExternalLink className="size-3.5" /> Open kiosk</Link>
                  </Button>
                ) : null}
                <Button
                  size="sm" variant="outline" className="glass h-8 text-xs"
                  onClick={async () => {
                    try { await toggle({ id: d._id }); } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
                  }}
                >
                  <Power className="size-3.5" /> {d.active ? "Disable" : "Enable"}
                </Button>
                <Button
                  size="sm" variant="outline" className="glass h-8 text-xs text-destructive"
                  onClick={async () => {
                    try { await remove({ id: d._id }); toast.success("Display removed"); } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
                  }}
                >
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
