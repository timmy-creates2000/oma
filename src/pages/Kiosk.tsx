import { api } from "@/convex/_generated/api";
import { useQuery, useMutation } from "convex/react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/glass";
import { ScanLine, ChevronLeft, RefreshCw } from "lucide-react";

/** Deterministic visual matrix rendered from the current token.
 *  In this browser demo the "scan" action submits the current token's raw
 *  value directly (paste flow) — validation always happens on the server. */
function TokenMatrix({ value, size = 232 }: { value: string; size?: number }) {
  const cells = 25;
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let x = h >>> 0;
  const bits: boolean[] = [];
  for (let i = 0; i < cells * cells; i++) {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >> 17;
    x ^= x << 5;
    x >>>= 0;
    bits.push((x & 1) === 1);
  }
  const dim = size / cells;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="rounded-xl bg-white p-1.5 shadow-inner">
      {bits.map((on, i) =>
        on ? (
          <rect
            key={i}
            x={(i % cells) * dim + 1.5}
            y={Math.floor(i / cells) * dim + 1.5}
            width={dim - 1}
            height={dim - 1}
            fill="#111827"
            rx={1.5}
          />
        ) : null,
      )}
      {[
        [0, 0],
        [cells - 7, 0],
        [0, cells - 7],
      ].map(([fx, fy], idx) => (
        <g key={idx}>
          <rect x={fx * dim + 1.5} y={fy * dim + 1.5} width={dim * 7 - 1} height={dim * 7 - 1} fill="#111827" rx={4} />
          <rect x={(fx + 1) * dim + 1.5} y={(fy + 1) * dim + 1.5} width={dim * 5 - 1} height={dim * 5 - 1} fill="#fff" rx={3} />
          <rect x={(fx + 2) * dim + 1.5} y={(fy + 2) * dim + 1.5} width={dim * 3 - 1} height={dim * 3 - 1} fill="#111827" rx={2} />
        </g>
      ))}
    </svg>
  );
}

export default function Kiosk() {
  const ws = useQuery(api.workspace.get);
  const displays = useQuery(api.qrDisplays.list, {});
  const issueToken = useMutation(api.attendance.issueQrToken);
  const [displayId, setDisplayId] = useState<string | null>(null);  const [qr, setQr] = useState<{ raw: string; expiresAt: number } | null>(null);
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState<string | null>(null);

  // pick the first active display
  useEffect(() => {
    if (!displays || displayId) return;
    const firstActive = displays.find((d) => d.active);
    if (firstActive) setDisplayId(firstActive._id);
  }, [displays, displayId]);

  // mint tokens on a rotation cycle
  useEffect(() => {
    if (!displayId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const mint = async () => {
      try {
        const res = await issueToken({ displayId: displayId as any });
        if (!cancelled) {
          setQr({ raw: res.raw, expiresAt: res.expiresAt });
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to refresh QR");
      }
      if (!cancelled) timer = setTimeout(mint, 28500);
    };
    mint();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [displayId, issueToken]);

  // clock tick
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

  const ttl = ws.settings.qrRotationSeconds;
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
          <Link to="/dashboard">
            <ChevronLeft className="size-4" /> Back to app
          </Link>
        </Button>
      </div>

      <GlassCard strong className="relative z-10 w-full max-w-md p-8 text-center">
        <div className="mb-1 flex items-center justify-center gap-2 text-sm font-semibold text-primary">
          <ScanLine className="size-4" /> {ws.company?.name ?? "OfficeFlow"}
        </div>
        <p className="mb-6 text-xs text-muted-foreground">
          {displays?.find((d) => d._id === displayId)?.label ?? "Kiosk"}
        </p>

        <div className="glass-inset relative mx-auto flex size-64 items-center justify-center rounded-3xl">
          {qr ? (
            <TokenMatrix value={qr.raw} size={232} />
          ) : (
            <RefreshCw className="size-6 animate-spin text-muted-foreground" />
          )}
          <svg className="pointer-events-none absolute inset-0 -rotate-90" width="256" height="256">
            <circle cx="128" cy="128" r="124" stroke="rgba(99,102,241,0.15)" strokeWidth="5" fill="none" />
            <circle
              cx="128"
              cy="128"
              r="124"
              stroke="#6366f1"
              strokeWidth="5"
              fill="none"
              strokeDasharray={2 * Math.PI * 124}
              strokeDashoffset={2 * Math.PI * 124 * (1 - pct)}
              strokeLinecap="round"
              className="transition-[stroke-dashoffset] duration-200"
            />
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
