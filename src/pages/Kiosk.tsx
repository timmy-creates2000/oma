import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { Link, useSearchParams } from "react-router";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/glass";
import { ScanLine, ChevronLeft, RefreshCw, Power } from "lucide-react";
import { Switch } from "@/components/ui/switch";
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
  const [params] = useSearchParams();
  const wantedId = params.get("display");
  const [display, setDisplay] = useState<{ id: string; label: string; active: boolean } | null>(null);
  const [qr, setQr] = useState<{ raw: string; expiresAt: number } | null>(null);
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState<string | null>(null);
  const [displayChecked, setDisplayChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const minting = useRef(false);
  const ttl = ws?.settings?.qr_rotation_seconds ?? 10;
  const displayId = display?.id ?? null;
  const isOn = !!display?.active;

  // load the display (prefer ?display=id, then an active one, then any)
  useEffect(() => {
    if (!ws) return;
    (async () => {
      const { data } = await supabase
        .from("qr_displays")
        .select("id, label, active")
        .eq("company_id", ws.employee.company_id)
        .order("created_at", { ascending: true });
      const list = (data ?? []) as Array<{ id: string; label: string; active: boolean }>;
      const pick = list.find((d) => d.id === wantedId) ?? list.find((d) => d.active) ?? list[0] ?? null;
      setDisplay(pick);
      setDisplayChecked(true);
    })();
  }, [ws, wantedId, reloadKey]);

  const createDisplay = async () => {
    setBusy(true);
    try {
      const { error } = await supabase.rpc("create_qr_display", { p_label: "Main Entrance", p_branch: null });
      if (error) throw error;
      setReloadKey((k) => k + 1);
    } catch (e) {
      setError(err(e));
    } finally {
      setBusy(false);
    }
  };

  const setOn = async (on: boolean) => {
    if (!display || display.active === on) return;
    setBusy(true);
    try {
      const { error } = await supabase.rpc("toggle_qr_display", { p_id: display.id });
      if (error) throw error;
      setQr(null);
      setError(null);
      setReloadKey((k) => k + 1);
    } catch (e) {
      setError(err(e));
    } finally {
      setBusy(false);
    }
  };

  // Mint a fresh token. Guarded so calls never overlap.
  const mint = useCallback(async () => {
    if (!displayId || minting.current) return;
    minting.current = true;
    try {
      const { data, error } = await supabase.rpc("issue_qr_token", { p_display: displayId });
      if (error) throw error;
      const v = data as { raw: string; expiresAt: number };
      if (v) {
        setQr({ raw: v.raw, expiresAt: Number(v.expiresAt) });
        setError(null);
      }
    } catch (e) {
      const msg = err(e);
      if (/turned off/i.test(msg)) {
        setQr(null);
        setDisplay((d) => (d ? { ...d, active: false } : d));
      } else {
        setError(msg);
      }
    } finally {
      minting.current = false;
    }
  }, [displayId]);

  // Watchdog: every second, refresh if there is no code or it is about to expire.
  // (A single long setTimeout gets frozen in background tabs, which is why the QR used to stop.)
  useEffect(() => {
    if (!displayId || !isOn) return;
    mint();
    const t = setInterval(() => {
      setNow(Date.now());
    }, 250);
    return () => clearInterval(t);
  }, [displayId, isOn, mint]);

  useEffect(() => {
    if (!displayId || !isOn) return;
    const lead = Math.min(2500, (ttl * 1000) / 3);
    const check = () => {
      if (!qr || Date.now() > qr.expiresAt - lead) mint();
    };
    const t = setInterval(check, 1000);
    const wake = () => { if (document.visibilityState === "visible") check(); };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", wake);
    window.addEventListener("online", wake);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("focus", wake);
      window.removeEventListener("online", wake);
    };
  }, [displayId, isOn, qr, ttl, mint]);

  // keep the screen awake while the kiosk is open
  useEffect(() => {
    type WakeLockSentinelLike = { release: () => Promise<void> };
    let lock: WakeLockSentinelLike | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<WakeLockSentinelLike> } };
    const acquire = async () => {
      try { lock = (await nav.wakeLock?.request("screen")) ?? null; } catch { /* not supported */ }
    };
    acquire();
    const again = () => { if (document.visibilityState === "visible") acquire(); };
    document.addEventListener("visibilitychange", again);
    return () => {
      document.removeEventListener("visibilitychange", again);
      lock?.release().catch(() => {});
    };
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

  const remaining = qr && isOn ? Math.max(0, Math.ceil((qr.expiresAt - now) / 1000)) : 0;
  const pct = qr && isOn ? Math.max(0, Math.min(1, remaining / ttl)) : 0;

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
        <p className="mb-6 text-xs text-muted-foreground">{display?.label ?? "Kiosk"}</p>

        <div className="glass-inset relative mx-auto flex size-64 items-center justify-center rounded-3xl">
          {!displayChecked ? (
            <RefreshCw className="size-6 animate-spin text-muted-foreground" />
          ) : !display ? (
            <div className="flex flex-col items-center gap-3 p-4 text-center">
              <p className="text-sm text-muted-foreground">No QR display yet.</p>
              <Button onClick={createDisplay} disabled={busy}>{busy ? "Creating…" : "Create display"}</Button>
            </div>
          ) : !isOn ? (
            <div className="flex flex-col items-center gap-3 p-4 text-center">
              <Power className="size-7 text-muted-foreground" />
              <p className="text-sm font-semibold">QR is turned OFF</p>
              <p className="text-xs text-muted-foreground">Nobody can clock in right now.</p>
              <Button onClick={() => setOn(true)} disabled={busy}>Turn QR on</Button>
            </div>
          ) : qr && qr.expiresAt > now ? (
            <QrImage value={qr.raw} size={232} />
          ) : (
            <div className="flex flex-col items-center gap-2 text-center">
              <RefreshCw className="size-6 animate-spin text-muted-foreground" />
              <p className="text-xs text-muted-foreground">{error ? "Reconnecting…" : "Generating code…"}</p>
            </div>
          )}
          <svg className={`pointer-events-none absolute inset-0 -rotate-90 ${isOn && qr ? "" : "hidden"}`} width="256" height="256">
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
        {display && (
          <div className="mx-auto mt-5 flex max-w-xs items-center justify-between gap-3 rounded-2xl border bg-white/40 px-4 py-3 text-left">
            <div>
              <p className="text-sm font-semibold">{isOn ? "QR is ON" : "QR is OFF"}</p>
              <p className="text-xs text-muted-foreground">{isOn ? "Employees can clock in and out" : "Clock in and out is paused"}</p>
            </div>
            <Switch checked={isOn} disabled={busy} onCheckedChange={(v) => setOn(v)} aria-label="Turn QR on or off" />
          </div>
        )}
        {error && isOn && <p className="mt-3 text-sm text-destructive">{error}</p>}
      </GlassCard>

      <p className="relative z-10 mt-6 text-xs text-muted-foreground">
        Single-use tokens · server-side validation · replay &amp; expiry protected
      </p>
    </div>
  );
}
