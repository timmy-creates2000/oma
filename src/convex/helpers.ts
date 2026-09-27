import { getAuthUserId } from "@convex-dev/auth/server";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { APP_ROLES } from "./schema";

/* ------------------------------- context ctx ------------------------------- */

export type Ctx = QueryCtx | MutationCtx;

/* --------------------------------- day keys -------------------------------- */

/** YYYY-MM-DD in UTC (company-local convention for this app). */
export function dayKey(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

export function dayKeyToDate(dk: string): Date {
  return new Date(`${dk}T00:00:00.000Z`);
}

export function todayKey(now: number): string {
  return dayKey(now);
}

export function addDaysKey(dk: string, days: number): string {
  const d = dayKeyToDate(dk);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Day key N days before `dk`, oldest first not required. */
export function lastNDays(endDk: string, n: number): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(addDaysKey(endDk, -i));
  return out;
}

export function minutesOfDayUTC(ts: number): number {
  const d = new Date(ts);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

export function fmtTime(ts: number): string {
  return new Date(ts).toISOString().slice(11, 16);
}

/* ------------------------------ attendance calc ---------------------------- */

const WEEKEND_DAY = 0; // Sunday
const WEEKEND_DAY2 = 6; // Saturday

export function isWorkDay(
  wh: { workDays: number[] | readonly number[] },
  dk: string,
): boolean {
  const dow = dayKeyToDate(dk).getUTCDay();
  return wh.workDays.includes(dow);
}

export type ArrivalResult = {
  status: "present" | "late";
  lateMinutes: number;
};

export function arrivalStatus(
  wh: Doc<"companies">["workingHours"],
  clockInAt: number,
): ArrivalResult {
  const arrived = minutesOfDayUTC(clockInAt);
  const deadline = wh.startMinutes + wh.lateGraceMinutes;
  if (arrived > deadline) {
    return { status: "late", lateMinutes: arrived - deadline };
  }
  return { status: "present", lateMinutes: 0 };
}

/** Calculate the closing fields when a clock-out happens. */
export function computeClose(
  wh: Doc<"companies">["workingHours"],
  clockInAt: number,
  clockOutAt: number,
  breakMinutes: number,
) {
  const worked = Math.max(0, Math.round((clockOutAt - clockInAt) / 60000) - breakMinutes);
  const scheduled = Math.max(1, wh.endMinutes - wh.startMinutes);
  const arr = arrivalStatus(wh, clockInAt);
  const endMinutes = minutesOfDayUTC(clockOutAt);
  const earlyLeave = Math.max(0, wh.endMinutes - endMinutes);
  const halfDay = worked < Math.round(scheduled / 2);
  const overtime = Math.max(0, worked - scheduled);
  const status = halfDay ? ("half_day" as const) : arr.status;
  return {
    workedMinutes: worked,
    lateMinutes: arr.lateMinutes,
    earlyLeaveMinutes: earlyLeave,
    overtimeMinutes: overtime,
    status,
  };
}

/* ---------------------------- auth / workspace ctx -------------------------- */

export type Workspace = {
  user: Doc<"users">;
  company: Doc<"companies">;
  employee: Doc<"employees">;
  settings: Doc<"companySettings">;
};

export async function requireWorkspace(ctx: Ctx): Promise<Workspace> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) throw new Error("Not authenticated");
  const user = await ctx.db.get(userId);
  if (!user) throw new Error("Not authenticated");
  const employee = await ctx.db
    .query("employees")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .filter((q) => q.eq(q.field("active"), true))
    .first();
  if (!employee) throw new Error("No workspace: you are not part of a company yet.");
  const company = await ctx.db.get(employee.companyId);
  if (!company) throw new Error("Company not found");
  const settings = await companySettingsFor(ctx, company._id);
  return { user, company, employee, settings };
}

export async function optionalWorkspace(ctx: Ctx): Promise<Workspace | null> {
  try {
    return await requireWorkspace(ctx);
  } catch {
    return null;
  }
}

export async function companySettingsFor(
  ctx: Ctx,
  companyId: Id<"companies">,
): Promise<Doc<"companySettings">> {
  const existing = await ctx.db
    .query("companySettings")
    .withIndex("by_company", (q) => q.eq("companyId", companyId))
    .first();
  if (existing) return existing;
  const id = await (ctx as MutationCtx).db.insert("companySettings", {
    companyId,
    qrRotationSeconds: 30,
    requireGeo: false,
    autoClockOutHours: 14,
    retentionDays: 730,
  });
  const created = await (ctx as MutationCtx).db.get(id);
  if (!created) throw new Error("Failed to create company settings");
  return created;
}

export function isAdminRole(role: string): boolean {
  return role === APP_ROLES.COMPANY_ADMIN || role === APP_ROLES.HR_ADMIN;
}

export function can(role: string, perm: string): boolean {
  const map: Record<string, string[]> = {
    [APP_ROLES.COMPANY_ADMIN]: [
      "manage_company", "manage_employees", "manage_attendance", "manage_leave",
      "manage_devices", "manage_qr", "view_reports", "view_audit", "manage_settings",
      "approve_leave", "approve_corrections", "approve_devices",
    ],
    [APP_ROLES.HR_ADMIN]: [
      "manage_employees", "manage_attendance", "manage_leave", "manage_devices",
      "manage_qr", "view_reports", "approve_leave", "approve_corrections", "approve_devices",
    ],
    [APP_ROLES.MANAGER]: ["view_reports", "approve_leave", "review_corrections"],
    [APP_ROLES.EMPLOYEE]: [],
  };
  return (map[role] ?? []).includes(perm);
}

export function requirePerm(ws: Workspace, perm: string) {
  if (!can(ws.employee.role, perm)) {
    throw new Error(`Forbidden: your role (${ws.employee.role}) cannot ${perm}`);
  }
}

/* --------------------------------- audit log -------------------------------- */

export async function audit(
  ctx: MutationCtx,
  ws: Pick<Workspace, "company" | "user">,
  action: string,
  detail?: string,
) {
  await ctx.db.insert("auditLogs", {
    companyId: ws.company._id,
    actorEmail: ws.user.email ?? ws.user.name ?? "unknown",
    action,
    detail,
    at: Date.now(),
  });
}

export async function notify(
  ctx: MutationCtx,
  args: {
    companyId: Id<"companies">;
    audience: "user" | "admins" | "employee";
    forUserId?: Id<"users">;
    type: string;
    title: string;
    body: string;
  },
) {
  await ctx.db.insert("notifications", {
    companyId: args.companyId,
    forUserId: args.forUserId,
    audience: args.audience,
    type: args.type,
    title: args.title,
    body: args.body,
    createdAt: Date.now(),
  });
}

/* ------------------------------- crypto utils ------------------------------- */

/** Hex sha-256 of a string. Raw QR tokens are never persisted — only this hash. */
export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function randomToken(bytes = 32): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
