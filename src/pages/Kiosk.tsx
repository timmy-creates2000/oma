import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/glass";
import { ScanLine, ChevronLeft, RefreshCw } from "lucide-react";
import { supabase, err } from "@/lib/sb";
import { useWorkspace } from "@/hooks/use-workspace";

/** Real, scannable QR code for the current token. Validation always happens on the server (scan_qr RPC). */
function QrImage({ value, size = 232 }: { value: string; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current) {
      QRCode.toCanvas(ref.current, value, { width: size, margin: 1, errorCorrectionLevel: "M" }).catch(() => {});
    }
  }, [value, size]);
  return <canvas ref={ref} width={size} height={size} className="rounded-xl bg-white p-1.5 shadow-inner" />;
}

export default function Kiosk() {
  const { ws } = useWorkspace();
  const [displayId, setDisplayId] = useState<string | null>(null);
  const [displayLabel, setDisplayLabel] = useState("Kiosk");
  const [qr, setQr] = useState<{ raw: string; expiresAt: number } | null>(null);
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState<string | null>(null);

  const [displayChecked, setDisplayChecked] = useState(false);
  const [creating, setCreating] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const ttl = ws?.settings?.qr_rotation_seconds ?? 10;

  const createDisplay = async () => {
    setCreating(true);
    try {
      const { error } = await supabase.rpc("create_qr_display", { p_label: "Main Entrance", p_branch: null });
      if (error) throw error;
      setReloadKey((k) => k + 1);
    } catch (e) {
      setError(err(e));
    } finally {
      setCreating(false);
    }
  };

  // pick the first active display
  useEffect(() => {
    if (!ws || displayId) return;
    (async () => {
      const { data } = await supabase
        .from("qr_displays")
        .select("id, label")
        .eq("company_id", ws.employee.company_id)
        .eq("active", true)
        .order("created_at", { ascending: true })
        .limit(1);
      const d = (data as Array<{ id: string; label: string }> | null)?.[0];
      if (d) {
        setDisplayId(d.id);
        setDisplayLabel(d.label);
      }
      setDisplayChecked(true);
    })();
  }, [ws, displayId, reloadKey]);

  // mint tokens on a rotation cycle
  useEffect(() => {
    if (!displayId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const mint = async () => {
      try {
        const { data, error } = await supabase.rpc("issue_qr_token", { p_display: displayId });
        if (error) throw error;
        const v = data as { raw: string; expiresAt: number };
        if (!cancelled && v) {
          setQr({ raw: v.raw, expiresAt: Number(v.expiresAt) });
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(err(e));
      }
      if (!cancelled) timer = setTimeout(mint, Math.max(2000, (ttl - 1.5) * 1000));
    };
    mint();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [displayId, ttl]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);

  if (!ws) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="glass-strong flex items-center gap-2 rounded-2xl px-6 py-4 text-sm text-muted-foreground">
          <RefreshCw className="size-4 animate-spin" /> Loading kiosk…
        </div>
      </div>
    );
  }

  const remaining = qr ? Math.max(0, Math.ceil((qr.expiresAt - now) / 1000)) : 0;
  const pct = qr ? Math.max(0, Math.min(1, remaining / ttl)) : 0;

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center p-6">
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-32 left-1/4 size-[28rem] rounded-full bg-blue-300/40 blur-3xl" />
        <div className="absolute bottom-0 right-1/4 size-[24rem] rounded-full bg-violet-300/40 blur-3xl" />
      </div>

      <div className="absolute left-6 top-6">
        <Button asChild variant="outline" className="glass">
          <Link to="/dashboard"><ChevronLeft className="size-4" /> Back to app</Link>
        </Button>
      </div>

      <GlassCard strong className="relative z-10 w-full max-w-md p-8 text-center">
        <div className="mb-1 flex items-center justify-center gap-2 text-sm font-semibold text-primary">
          <ScanLine className="size-4" /> {ws.company?.name ?? "OfficeFlow"}
        </div>
        <p className="mb-6 text-xs text-muted-foreground">{displayLabel}</p>

        <div className="glass-inset relative mx-auto flex size-64 items-center justify-center rounded-3xl">
          {qr ? (
            <QrImage value={qr.raw} size={232} />
          ) : displayChecked && !displayId ? (
            <div className="flex flex-col items-center gap-3 p-4 text-center">
              <p className="text-sm text-muted-foreground">No active QR display yet.</p>
              <Button onClick={createDisplay} disabled={creating}>
                {creating ? "Creating…" : "Create display"}
              </Button>
            </div>
          ) : (
            <RefreshCw className="size-6 animate-spin text-muted-foreground" />
          )}
          <svg className="pointer-events-none absolute inset-0 -rotate-90" width="256" height="256">
            <circle cx="128" cy="128" r="124" stroke="rgba(99,102,241,0.15)" strokeWidth="5" fill="none" />
            <circle cx="128" cy="128" r="124" stroke="#6366f1" strokeWidth="5" fill="none"
              strokeDasharray={2 * Math.PI * 124}
              strokeDashoffset={2 * Math.PI * 124 * (1 - pct)}
              strokeLinecap="round"
              className="transition-[stroke-dashoffset] duration-200" />
          </svg>
        </div>

        <p className="mt-4 text-2xl font-bold tabular-nums">{remaining}s</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Employees scan this with the mobile app · rotates every {ttl}s
        </p>
        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
      </GlassCard>

      <p className="relative z-10 mt-6 text-xs text-muted-foreground">
        Single-use tokens · server-side validation · replay &amp; expiry protected
      </p>
    </div>
  );
}
