import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { Infer, v } from "convex/values";

/* ---------------------------------- enums --------------------------------- */

export const APP_ROLES = {
  COMPANY_ADMIN: "company_admin",
  HR_ADMIN: "hr_admin",
  MANAGER: "manager",
  EMPLOYEE: "employee",
} as const;

export const appRoleValidator = v.union(
  v.literal(APP_ROLES.COMPANY_ADMIN),
  v.literal(APP_ROLES.HR_ADMIN),
  v.literal(APP_ROLES.MANAGER),
  v.literal(APP_ROLES.EMPLOYEE),
);
export type AppRole = Infer<typeof appRoleValidator>;

export const DEVICE_STATUS = {
  ACTIVE: "active",
  PENDING_REPLACEMENT: "pending_replacement",
  REVOKED: "revoked",
} as const;
export const deviceStatusValidator = v.union(
  v.literal(DEVICE_STATUS.ACTIVE),
  v.literal(DEVICE_STATUS.PENDING_REPLACEMENT),
  v.literal(DEVICE_STATUS.REVOKED),
);

export const ATTENDANCE_STATUS = {
  PRESENT: "present",
  LATE: "late",
  HALF_DAY: "half_day",
  ONGOING: "ongoing",
  HOLIDAY: "holiday",
  WEEKEND: "weekend",
  ON_LEAVE: "on_leave",
  ABSENT: "absent",
} as const;
export const attendanceStatusValidator = v.union(
  v.literal(ATTENDANCE_STATUS.PRESENT),
  v.literal(ATTENDANCE_STATUS.LATE),
  v.literal(ATTENDANCE_STATUS.HALF_DAY),
  v.literal(ATTENDANCE_STATUS.ONGOING),
  v.literal(ATTENDANCE_STATUS.HOLIDAY),
  v.literal(ATTENDANCE_STATUS.WEEKEND),
  v.literal(ATTENDANCE_STATUS.ON_LEAVE),
  v.literal(ATTENDANCE_STATUS.ABSENT),
);

export const EVENT_KIND = {
  CLOCK_IN: "clock_in",
  CLOCK_OUT: "clock_out",
  BREAK_START: "break_start",
  BREAK_END: "break_end",
  AUTO_CLOCK_OUT: "auto_clock_out",
} as const;
export const eventKindValidator = v.union(
  v.literal(EVENT_KIND.CLOCK_IN),
  v.literal(EVENT_KIND.CLOCK_OUT),
  v.literal(EVENT_KIND.BREAK_START),
  v.literal(EVENT_KIND.BREAK_END),
  v.literal(EVENT_KIND.AUTO_CLOCK_OUT),
);

export const LEAVE_STATUS = {
  PENDING: "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
  CANCELLED: "cancelled",
} as const;
export const leaveStatusValidator = v.union(
  v.literal(LEAVE_STATUS.PENDING),
  v.literal(LEAVE_STATUS.APPROVED),
  v.literal(LEAVE_STATUS.REJECTED),
  v.literal(LEAVE_STATUS.CANCELLED),
);

export const REQUEST_STATUS = {
  PENDING: "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
} as const;
export const requestStatusValidator = v.union(
  v.literal(REQUEST_STATUS.PENDING),
  v.literal(REQUEST_STATUS.APPROVED),
  v.literal(REQUEST_STATUS.REJECTED),
);

/* ---------------------------------- tables -------------------------------- */

const schema = defineSchema(
  {
    // default auth tables using convex auth.
    ...authTables, // do not remove or modify

    users: defineTable({
      name: v.optional(v.string()),
      image: v.optional(v.string()),
      email: v.optional(v.string()),
      emailVerificationTime: v.optional(v.number()),
      isAnonymous: v.optional(v.boolean()),
      role: v.optional(v.string()), // kept for template compatibility
    }).index("email", ["email"]),

    /* ------------------------------- tenancy ------------------------------- */

    companies: defineTable({
      name: v.string(),
      slug: v.string(),
      industry: v.optional(v.string()),
      workingHours: v.object({
        startMinutes: v.number(), // minutes from midnight, e.g. 540 = 09:00
        endMinutes: v.number(),
        lateGraceMinutes: v.number(),
        workDays: v.array(v.number()), // 0=Sun .. 6=Sat
      }),
      geoVerification: v.boolean(),
      createdAt: v.number(),
      createdBy: v.optional(v.id("users")),
    })
      .index("by_slug", ["slug"])
      .index("by_createdBy", ["createdBy"]),

    branches: defineTable({
      companyId: v.id("companies"),
      name: v.string(),
      address: v.optional(v.string()),
      latitude: v.optional(v.number()),
      longitude: v.optional(v.number()),
      geofenceRadiusM: v.optional(v.number()),
    }).index("by_company", ["companyId"]),

    departments: defineTable({
      companyId: v.id("companies"),
      name: v.string(),
    }).index("by_company", ["companyId"]),

    /* ------------------------------ employees ------------------------------ */

    employees: defineTable({
      companyId: v.id("companies"),
      userId: v.optional(v.id("users")),
      email: v.string(),
      name: v.string(),
      employeeCode: v.string(),
      role: appRoleValidator,
      departmentId: v.optional(v.id("departments")),
      branchId: v.optional(v.id("branches")),
      position: v.optional(v.string()),
      managerEmail: v.optional(v.string()),
      joinedAt: v.optional(v.number()),
      active: v.boolean(),
      deletedAt: v.optional(v.number()), // soft delete
    })
      .index("by_company", ["companyId"])
      .index("by_company_email", ["companyId", "email"])
      .index("by_user", ["userId"])
      .index("by_department", ["departmentId"])
      .index("by_branch", ["branchId"]),

    /* ------------------------------- devices ------------------------------- */

    registeredDevices: defineTable({
      companyId: v.id("companies"),
      employeeId: v.id("employees"),
      label: v.string(),
      platform: v.string(),
      publicKeyFingerprint: v.string(), // short hash identifying keypair
      status: deviceStatusValidator,
      registeredAt: v.number(),
      revokedAt: v.optional(v.number()),
    })
      .index("by_employee", ["employeeId"])
      .index("by_company", ["companyId"])
      .index("by_fingerprint", ["publicKeyFingerprint"]),

    deviceEvents: defineTable({
      companyId: v.id("companies"),
      deviceId: v.id("registeredDevices"),
      employeeId: v.id("employees"),
      type: v.union(
        v.literal("registered"),
        v.literal("replacement_requested"),
        v.literal("replacement_approved"),
        v.literal("revoked"),
        v.literal("scan_rejected"),
      ),
      detail: v.optional(v.string()),
      actor: v.optional(v.string()),
      at: v.number(),
    }).index("by_company", ["companyId", "at"]),

    /* ------------------------------- QR system ----------------------------- */

    qrDisplays: defineTable({
      companyId: v.id("companies"),
      branchId: v.optional(v.id("branches")),
      label: v.string(),
      active: v.boolean(),
      createdAt: v.number(),
    }).index("by_company", ["companyId"]),

    qrTokens: defineTable({
      companyId: v.id("companies"),
      displayId: v.id("qrDisplays"),
      tokenHash: v.string(), // sha256 of raw token — raw token never stored
      nonce: v.string(),
      issuedAt: v.number(),
      expiresAt: v.number(),
      consumedAt: v.optional(v.number()),
      consumedBy: v.optional(v.id("employees")),
    })
      .index("by_tokenHash", ["tokenHash"])
      .index("by_display", ["displayId", "issuedAt"])
      .index("by_expires", ["expiresAt"]),

    /* ------------------------------ attendance ----------------------------- */

    attendanceSessions: defineTable({
      companyId: v.id("companies"),
      employeeId: v.id("employees"),
      dayKey: v.string(), // "YYYY-MM-DD" company-local
      clockInAt: v.number(),
      clockOutAt: v.optional(v.number()),
      breakMinutes: v.number(),
      status: attendanceStatusValidator,
      lateMinutes: v.number(),
      earlyLeaveMinutes: v.number(),
      overtimeMinutes: v.number(),
      workedMinutes: v.optional(v.number()),
      clockInDeviceId: v.optional(v.id("registeredDevices")),
      clockInDisplayId: v.optional(v.id("qrDisplays")),
      clockOutDeviceId: v.optional(v.id("registeredDevices")),
      geoVerified: v.boolean(),
      deletedAt: v.optional(v.number()),
    })
      .index("by_employee_day", ["employeeId", "dayKey"])
      .index("by_company_day", ["companyId", "dayKey"])
      .index("by_employee_recent", ["employeeId", "clockInAt"]),

    attendanceEvents: defineTable({
      companyId: v.id("companies"),
      employeeId: v.id("employees"),
      sessionId: v.optional(v.id("attendanceSessions")),
      kind: eventKindValidator,
      at: v.number(),
      dayKey: v.string(),
      deviceId: v.optional(v.id("registeredDevices")),
      displayId: v.optional(v.id("qrDisplays")),
      geoVerified: v.optional(v.boolean()),
    })
      .index("by_company", ["companyId", "at"])
      .index("by_employee", ["employeeId", "at"])
      .index("by_session", ["sessionId"]),

    correctionRequests: defineTable({
      companyId: v.id("companies"),
      employeeId: v.id("employees"),
      sessionDate: v.string(), // dayKey the correction targets
      requestedClockInAt: v.optional(v.number()),
      requestedClockOutAt: v.optional(v.number()),
      reason: v.string(),
      status: requestStatusValidator,
      reviewerNote: v.optional(v.string()),
      reviewedBy: v.optional(v.string()),
      reviewedAt: v.optional(v.number()),
      createdAt: v.number(),
    })
      .index("by_company_status", ["companyId", "status"])
      .index("by_employee", ["employeeId"]),

    /* --------------------------------- leave -------------------------------- */

    leaveTypes: defineTable({
      companyId: v.id("companies"),
      name: v.string(),
      annualQuotaDays: v.number(),
      paid: v.boolean(),
    }).index("by_company", ["companyId"]),

    leaveRequests: defineTable({
      companyId: v.id("companies"),
      employeeId: v.id("employees"),
      leaveTypeId: v.id("leaveTypes"),
      startDate: v.string(), // dayKey
      endDate: v.string(), // dayKey inclusive
      reason: v.string(),
      status: leaveStatusValidator,
      decidedBy: v.optional(v.string()),
      decidedAt: v.optional(v.number()),
      decisionNote: v.optional(v.string()),
      createdAt: v.number(),
    })
      .index("by_company_status", ["companyId", "status"])
      .index("by_employee", ["employeeId"])
      .index("by_company_range", ["companyId", "startDate"]),

    leaveBalances: defineTable({
      companyId: v.id("companies"),
      employeeId: v.id("employees"),
      leaveTypeId: v.id("leaveTypes"),
      year: v.number(),
      usedDays: v.number(),
    })
      .index("by_employee_type", ["employeeId", "leaveTypeId"])
      .index("by_company_year", ["companyId", "year"]),

    publicHolidays: defineTable({
      companyId: v.id("companies"),
      date: v.string(), // dayKey
      name: v.string(),
    }).index("by_company_date", ["companyId", "date"]),

    /* ---------------------- notifications / audit / settings ---------------- */

    notifications: defineTable({
      companyId: v.id("companies"),
      forUserId: v.optional(v.id("users")), // null = HR/admin audience
      audience: v.union(
        v.literal("user"),
        v.literal("admins"),
        v.literal("employee"),
      ),
      type: v.string(),
      title: v.string(),
      body: v.string(),
      readAt: v.optional(v.number()),
      createdAt: v.number(),
    })
      .index("by_audience", ["companyId", "audience", "createdAt"])
      .index("by_user", ["forUserId", "createdAt"]),

    auditLogs: defineTable({
      companyId: v.optional(v.id("companies")),
      actorEmail: v.string(),
      action: v.string(),
      detail: v.optional(v.string()),
      at: v.number(),
    }).index("by_company", ["companyId", "at"]),

    companySettings: defineTable({
      companyId: v.id("companies"),
      qrRotationSeconds: v.number(),
      requireGeo: v.boolean(),
      autoClockOutHours: v.number(),
      retentionDays: v.number(),
    }).index("by_company", ["companyId"]),
  },
);

// strict validation: every write must match the validators above.

export default schema;
