import { api } from "../../convex/_generated/api";

export { api };

/* --------------------------------- helpers --------------------------------- */

/** Instants are epoch milliseconds on the Convex side. */
export function fmtTime(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  return new Date(ms).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** Day keys are "YYYY-MM-DD" strings and must not shift across timezones. */
export function fmtDay(key: string | null | undefined): string {
  if (!key) return "—";
  return new Date(`${key}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export function shiftDay(key: string, days: number): string {
  const [y, m, d] = key.split("-").map((n) => parseInt(n, 10));
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Renders a minute-of-day (e.g. 545) as "09:05". */
export function fmtMinuteOfDay(minute: number): string {
  const h = Math.floor(minute / 60) % 24;
  const m = minute % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function fmtDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export function err(e: unknown): string {
  return e instanceof Error ? e.message : String(e ?? "Something went wrong");
}
