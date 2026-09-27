import { getAuthUserId } from "@convex-dev/auth/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

export type Role = "company_admin" | "hr_admin" | "manager" | "employee";

export type Perm =
  | "manage_company"
  | "manage_employees"
  | "manage_attendance"
  | "manage_leave"
  | "manage_devices"
  | "manage_qr"
  | "view_reports"
  | "view_audit"
  | "manage_settings"
  | "approve_leave"
  | "approve_corrections"
  | "approve_devices";

/**
 * Mirrors the SQL `can(perm)` helper. Keep in sync with hasPerm() in
 * src/components/AppShell.tsx.
 */
const ROLE_PERMS: Record<Role, readonly Perm[]> = {
  company_admin: [
    "manage_company",
    "manage_employees",
    "manage_attendance",
    "manage_leave",
    "manage_devices",
    "manage_qr",
    "view_reports",
    "view_audit",
    "manage_settings",
    "approve_leave",
    "approve_corrections",
    "approve_devices",
  ],
  hr_admin: [
    "manage_employees",
    "manage_attendance",
    "manage_leave",
    "manage_devices",
    "manage_qr",
    "view_reports",
    "approve_leave",
    "approve_corrections",
    "approve_devices",
  ],
  manager: ["view_reports", "approve_leave", "approve_corrections"],
  employee: [],
};

export function can(role: Role, perm: Perm): boolean {
  return ROLE_PERMS[role].includes(perm);
}

export function isAdmin(role: Role): boolean {
  return role === "company_admin" || role === "hr_admin";
}

export async function myEmployee(
  ctx: QueryCtx | MutationCtx,
): Promise<Doc<"employees"> | null> {
  const userId = await getAuthUserId(ctx);
  if (!userId) return null;
  return await ctx.db
    .query("employees")
    .withIndex("byUser", (q) => q.eq("userId", userId))
    .first();
}

export async function requireEmployee(
  ctx: QueryCtx | MutationCtx,
): Promise<Doc<"employees">> {
  const employee = await myEmployee(ctx);
  if (!employee) {
    throw new Error("You are not a member of any company yet");
  }
  return employee;
}

/**
 * The signed-in user's `users` document id.
 *
 * Do NOT use `identity.subject` for this: Convex Auth issues a composite
 * `userId|sessionId` subject, which fails `v.id("users")` validation.
 */
export async function currentUserId(
  ctx: QueryCtx | MutationCtx,
): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("You must be signed in");
  return userId;
}

export async function requirePerm(
  ctx: QueryCtx | MutationCtx,
  perm: Perm,
): Promise<Doc<"employees">> {
  const employee = await requireEmployee(ctx);
  if (!can(employee.role, perm)) {
    throw new Error("You do not have permission to do that");
  }
  return employee;
}

/**
 * Date-only values are "YYYY-MM-DD" strings in UTC so they never shift across
 * timezones. Instants are epoch milliseconds.
 */
export function dayKey(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

export function dateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function minutesOfDay(ts: number): number {
  const d = new Date(ts);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

export function atMinute(key: string, minute: number): number {
  const [y, m, d] = key.split("-").map((n) => parseInt(n, 10));
  return Date.UTC(y, m - 1, d, 0, 0, 0, 0) + minute * 60_000;
}

export function yearOf(key: string): number {
  return parseInt(key.slice(0, 4), 10);
}

export function weekdayOf(key: string): number {
  return new Date(`${key}T00:00:00.000Z`).getUTCDay();
}

export function isWorkDay(key: string, workDays: readonly number[]): boolean {
  return workDays.includes(weekdayOf(key));
}

export function shiftDay(key: string, days: number): string {
  const [y, m, d] = key.split("-").map((n) => parseInt(n, 10));
  return dateOnly(new Date(Date.UTC(y, m - 1, d + days)));
}

/** Inclusive count of working days between two day keys. */
export function workDaysBetween(
  start: string,
  end: string,
  workDays: readonly number[],
): number {
  if (end < start) return 0;
  let count = 0;
  let cursor = start;
  // Guard against pathological ranges; a year of days is plenty.
  for (let i = 0; i < 400; i++) {
    if (cursor > end) break;
    if (isWorkDay(cursor, workDays)) count++;
    cursor = shiftDay(cursor, 1);
  }
  return count;
}

export function haversineMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6_371_000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(a))));
}

export function slugify(value: string): string {  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "company";
}

/** Cryptographically strong hex string, used for QR token material. */
export function randomHex(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  const webCrypto = globalThis.crypto;
  if (webCrypto?.getRandomValues) {
    webCrypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < byteLength; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const SHA_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function rotr(x: number, n: number): number {
  return ((x >>> n) | (x << (32 - n))) >>> 0;
}

/**
 * SHA-256 of a UTF-8 string, hex encoded. Implemented locally so QR token
 * hashing works identically in every Convex runtime without Web Crypto.
 */
export function sha256Hex(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const bitLength = bytes.length * 8;
  const padded = new Uint8Array(((((bytes.length + 8) >> 6) + 1) << 6));
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 4, bitLength >>> 0, false);
  view.setUint32(
    padded.length - 8,
    Math.floor(bitLength / 0x1_0000_0000),
    false,
  );

  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
    0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Uint32Array(64);

  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15];
      const y = w[i - 2];
      const s0 = rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3);
      const s1 = rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let a = h[0];
    let b = h[1];
    let c = h[2];
    let d = h[3];
    let e = h[4];
    let f = h[5];
    let g = h[6];
    let hh = h[7];

    for (let i = 0; i < 64; i++) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (hh + s1 + ch + SHA_K[i] + w[i]) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;

      hh = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h[0] = (h[0] + a) >>> 0;
    h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0;
    h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0;
    h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0;
    h[7] = (h[7] + hh) >>> 0;
  }

  return Array.from(h)
    .map((n) => n.toString(16).padStart(8, "0"))
    .join("");
}

export async function companySettings(
  ctx: QueryCtx | MutationCtx,
  companyId: Id<"companies">,
): Promise<Doc<"companySettings"> | null> {
  return await ctx.db
    .query("companySettings")
    .withIndex("byCompany", (q) => q.eq("companyId", companyId))
    .first();
}

export async function actorEmail(
  ctx: QueryCtx | MutationCtx,
): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  return identity?.email ?? "system";
}

export async function audit(
  ctx: MutationCtx,
  companyId: Id<"companies"> | undefined,
  action: string,
  detail?: string,
): Promise<void> {
  await ctx.db.insert("auditLogs", {
    companyId,
    actorEmail: await actorEmail(ctx),
    action,
    detail,
    at: Date.now(),
  });
}

export async function notifyUser(
  ctx: MutationCtx,
  companyId: Id<"companies">,
  forUserId: Id<"users">,
  type: string,
  title: string,
  body: string,
): Promise<void> {
  await ctx.db.insert("notifications", {
    companyId,
    forUserId,
    audience: "user",
    type,
    title,
    body,
    createdAt: Date.now(),
  });
}

export async function notifyAdmins(
  ctx: MutationCtx,
  companyId: Id<"companies">,
  type: string,
  title: string,
  body: string,
): Promise<void> {
  await ctx.db.insert("notifications", {
    companyId,
    audience: "admins",
    type,
    title,
    body,
    createdAt: Date.now(),
  });
}

export async function notifyEmployee(
  ctx: MutationCtx,
  companyId: Id<"companies">,
  employee: Doc<"employees">,
  type: string,
  title: string,
  body: string,
): Promise<void> {
  await ctx.db.insert("notifications", {
    companyId,
    forUserId: employee.userId,
    audience: "employee",
    type,
    title,
    body,
    createdAt: Date.now(),
  });
}
