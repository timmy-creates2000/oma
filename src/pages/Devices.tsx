import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/AppShell";
import { GlassCard, PageHeader, Empty, StatTile } from "@/components/glass";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useQuery, useMutation } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";
import {
  Fingerprint, Smartphone, ShieldCheck, ShieldX, RotateCcw, RefreshCw, ScrollText,
} from "lucide-react";

const STATUS_META: Record<string, { label: string; cls: string }> = {
  active: { label: "Active", cls: "bg-emerald-500/15 text-emerald-700" },
  pending_replacement: { label: "Replacement pending", cls: "bg-amber-500/15 text-amber-700" },
  revoked: { label: "Revoked", cls: "bg-rose-500/15 text-rose-700" },
};

export default function Devices() {
  const data = useQuery(api.devices.companyDevices, {});
  const decideReplacement = useMutation(api.devices.decideReplacement);
  const revoke = useMutation(api.devices.revoke);
  const reactivate = useMutation(api.devices.reactivate);
  const [busy, setBusy] = useState<string | null>(null);

  const act = async (fn: () => Promise<unknown>, msg: string, id: string) => {
    setBusy(id);
    try {
      await fn();
      toast.success(msg);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  };

  if (!data) {
    return (
      <AppShell title="Devices">
        <GlassCard className="p-10 text-center text-sm text-muted-foreground">
          <RefreshCw className="mx-auto mb-2 size-5 animate-spin" /> Loading…
        </GlassCard>
      </AppShell>
    );
  }

  const { devices, events } = data;
  const active = devices.filter((d) => d.status === "active").length;
  const pending = devices.filter((d) => d.status === "pending_replacement");

  return (
    <AppShell title="Devices">
      <PageHeader
        title="Registered devices"
        subtitle="Device-bound credentials — scans from revoked devices are rejected server-side."
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatTile icon={Smartphone} label="Active devices" value={active} tone="text-emerald-600" />
        <StatTile icon={Fingerprint} label="Total registered" value={devices.length} />
        <StatTile icon={ShieldX} label="Replacement requests" value={pending.length} tone={pending.length ? "text-amber-600" : ""} />
      </div>

      {pending.length > 0 && (
        <GlassCard className="mb-4 p-5">
          <h3 className="mb-3 flex items-center gap-2 font-semibold text-amber-700">
            <ShieldX className="size-4" /> Pending replacement approvals
          </h3>
          <div className="space-y-2.5">
            {pending.map((d) => (
              <div key={d._id} className="glass-soft flex flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-3">
                <div>
                  <p className="text-sm font-semibold">{d.employee?.name ?? "Unknown"} — {d.label}</p>
                  <p className="text-xs text-muted-foreground">{d.platform} · registered {new Date(d.registeredAt).toLocaleDateString()}</p>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm" className="h-8"
                    disabled={busy === d._id}
                    onClick={() => act(() => decideReplacement({ deviceId: d._id, approve: true }), "Replacement approved — old device revoked", d._id)}
                  >
                    Approve & revoke
                  </Button>
                  <Button
                    size="sm" variant="outline" className="glass h-8"
                    disabled={busy === d._id}
                    onClick={() => act(() => decideReplacement({ deviceId: d._id, approve: false }), "Replacement rejected", d._id)}
                  >
                    Reject
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </GlassCard>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <GlassCard className="p-5 lg:col-span-2">
          <h3 className="mb-3 font-semibold">All devices</h3>
          {devices.length === 0 ? (
            <Empty icon={Smartphone} text="No devices registered." />
          ) : (
            <div className="space-y-2">
              {devices.map((d) => {
                const meta = STATUS_META[d.status];
                return (
                  <div key={d._id} className="glass-soft flex flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="glass-inset flex size-9 items-center justify-center rounded-lg">
                        <Smartphone className="size-4 text-primary" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold">{d.employee?.name ?? "Unknown"} <span className="ml-1 text-xs font-normal text-muted-foreground">· {d.label}</span></p>
                        <p className="font-mono text-[10px] text-muted-foreground">fp:{d.publicKeyFingerprint.slice(0, 16)}…</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className={meta.cls}>{meta.label}</Badge>
                      {d.status === "active" && (
                        <Button
                          size="sm" variant="outline" className="glass h-7 text-xs text-destructive"
                          disabled={busy === d._id}
                          onClick={() => act(() => revoke({ deviceId: d._id, reason: "Revoked by HR" }), "Device revoked", d._id)}
                        >
                          Revoke
                        </Button>
                      )}
                      {d.status === "revoked" && (
                        <Button
                          size="sm" variant="outline" className="glass h-7 text-xs"
                          disabled={busy === d._id}
                          onClick={() => act(() => reactivate({ deviceId: d._id }), "Device reactivated", d._id)}
                        >
                          <RotateCcw className="size-3.5" /> Reactivate
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </GlassCard>

        <GlassCard className="p-5">
          <h3 className="mb-3 flex items-center gap-2 font-semibold">
            <ScrollText className="size-4 text-primary" /> Security events
          </h3>
          {events.length === 0 ? (
            <Empty icon={ScrollText} text="No device events." />
          ) : (
            <div className="max-h-96 space-y-2 overflow-y-auto pr-1">
              {events.map((ev) => (
                <div key={ev._id} className="glass-soft rounded-xl px-3.5 py-2.5">
                  <div className="flex items-center justify-between">
                    <Badge
                      variant="secondary"
                      className={
                        ev.type === "registered" ? "bg-emerald-500/15 text-emerald-700"
                        : ev.type === "revoked" || ev.type === "scan_rejected" ? "bg-rose-500/15 text-rose-700"
                        : "bg-amber-500/15 text-amber-700"
                      }
                    >
                      {ev.type.replace(/_/g, " ")}
                    </Badge>
                    <span className="text-[10px] text-muted-foreground">{new Date(ev.at).toLocaleDateString()}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{ev.detail}</p>
                </div>
              ))}
            </div>
          )}
          <div className="glass-soft mt-4 flex items-start gap-2 rounded-xl p-3 text-xs text-muted-foreground">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" />
            Every registration, replacement and revocation is logged and auditable.
          </div>
        </GlassCard>
      </div>
    </AppShell>
  );
}
