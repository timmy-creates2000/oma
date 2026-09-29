import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!url || !key) {
  throw new Error("Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in environment variables.");
}

export const hasSupabaseCreds = true;

// Untyped client: row types are declared and cast in this module instead,
// which keeps RPC args and embedded-resource selects flexible.
export const supabase = createClient(url, key, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

/* --------------------------------- types ---------------------------------- */

export type Employee = {
  id: string;
  company_id: string;
  user_id: string | null;
  email: string;
  name: string;
  employee_code: string;
  role: "company_admin" | "hr_admin" | "manager" | "employee";
  department_id: string | null;
  branch_id: string | null;
  position: string | null;
  joined_at: string | null;
  active: boolean;
  deleted_at: string | null;
  departments?: { name: string } | null;
  branches?: { name: string } | null;
};

export type AttendanceSession = {
  id: string;
  company_id: string;
  employee_id: string;
  day_key: string;
  clock_in_at: string;
  clock_out_at: string | null;
  break_minutes: number;
  status: string;
  late_minutes: number;
  early_leave_minutes: number;
  overtime_minutes: number;
  worked_minutes: number | null;
  clock_in_device_id: string | null;
  clock_out_device_id: string | null;
  geo_verified: boolean;
};

export type Device = {
  id: string;
  company_id: string;
  employee_id: string;
  label: string;
  platform: string;
  public_key_fingerprint: string;
  status: "active" | "pending_replacement" | "revoked";
  registered_at: string;
  revoked_at: string | null;
  employees?: { name: string; employee_code: string } | null;
};

export type DeviceEvent = {
  id: string;
  type: string;
  detail: string | null;
  actor: string | null;
  at: string;
};

export type QrDisplay = {
  id: string;
  company_id: string;
  branch_id: string | null;
  label: string;
  active: boolean;
  created_at: string;
  branches?: { name: string } | null;
};

export type LeaveRequest = {
  id: string;
  company_id: string;
  employee_id: string;
  leave_type_id: string;
  start_date: string;
  end_date: string;
  reason: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  created_at: string;
  leave_types?: { name: string } | null;
  employees?: { name: string; employee_code: string } | null;
};

export type Correction = {
  id: string;
  company_id: string;
  employee_id: string;
  session_date: string;
  requested_clock_in_at: string | null;
  requested_clock_out_at: string | null;
  reason: string;
  status: "pending" | "approved" | "rejected";
  reviewer_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  employees?: { name: string; employee_code: string } | null;
};

export type Holiday = { id: string; date: string; name: string };
export type LeaveType = { id: string; name: string; annual_quota_days: number; paid: boolean };

export type Balance = {
  id: string;
  leave_type_id: string;
  year: number;
  used_days: number;
  leave_types: { name: string; annual_quota_days: number; paid: boolean } | null;
};

export type Notification = {
  id: string;
  type: string;
  title: string;
  body: string;
  audience: string;
  for_user_id: string | null;
  read_at: string | null;
  created_at: string;
};

export type AuditLog = {
  id: string;
  actor_email: string;
  action: string;
  detail: string | null;
  at: string;
};

export type Company = {
  id: string;
  name: string;
  slug: string;
  industry: string | null;
  start_minute: number;
  end_minute: number;
  late_grace_minutes: number;
  work_days: number[];
  geo_enabled: boolean;
};

export type CompanySettings = {
  company_id: string;
  qr_rotation_seconds: number;
  require_geo: boolean;
  auto_clock_out_hours: number;
  retention_days: number;
};

export type DashboardData = {
  counts: {
    total_employees: number;
    present: number;
    late: number;
    half_day: number;
    on_leave: number;
    ongoing: number;
    absent: number;
    missing_out: number;
    missing_devices: number;
  };
  trend: Array<{ day: string; present: number; late: number; absent: number }>;
  deptRows: Array<{ name: string; total: number; present: number; late: number; absent: number } | null>;
  recentEvents: Array<{ id: string; kind: string; at: string; day_key: string; employee_name: string; employee_code: string }>;
  pendingLeave: number;
  pendingCorrections: number;
  myRole: string;
};

export type RangeData = {
  totals: {
    employeeCount: number;
    attendanceRate: number;
    punctualityRate: number;
    avgArrival: string;
    avgDeparture: string;
    avgWorkedHours: number;
    totalLateMinutes: number;
    totalOvertimeHours: number;
    earlyDepartures: number;
    absenceDays: number;
    leaveDays: number;
  };
  perEmployee: Array<{
    employee_id: string;
    name: string;
    code: string;
    department: string;
    present_days: number;
    late_days: number;
    half_days: number;
    absent_days: number;
    leave_days: number;
    worked_hours: number;
    overtime_hours: number;
    late_minutes: number;
  }>;
  daily: Array<{ day: string; present: number; late: number; absent: number }>;
};

/* --------------------------------- helpers --------------------------------- */

export function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
}

export function fmtDay(dk: string | null): string {
  if (!dk) return "—";
  return new Date(`${dk}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric", timeZone: "UTC",
  });
}

export function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export function err(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object") {
    const obj = e as Record<string, unknown>;
    if (typeof obj.message === "string") return obj.message;
    if (typeof obj.error_description === "string") return obj.error_description;
    if (typeof obj.msg === "string") return obj.msg;
    try { return JSON.stringify(e); } catch { /* fall through */ }
  }
  return String(e ?? "Something went wrong");
}
