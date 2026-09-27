import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

export const ROLES = [
  "company_admin",
  "hr_admin",
  "manager",
  "employee",
] as const;
export type Role = (typeof ROLES)[number];

/**
 * Date-only columns are stored as "YYYY-MM-DD" strings so they never shift
 * across timezones. Instants are epoch milliseconds.
 */
export default defineSchema({
  ...authTables,

  companies: defineTable({
    name: v.string(),
    slug: v.string(),
    industry: v.optional(v.string()),
    startMinute: v.number(),
    endMinute: v.number(),
    lateGraceMinutes: v.number(),
    workDays: v.array(v.number()),
    geoEnabled: v.boolean(),
    createdBy: v.optional(v.id("users")),
    createdAt: v.number(),
  })
    .index("bySlug", ["slug"])
    .index("byCreator", ["createdBy"]),

  employees: defineTable({
    companyId: v.id("companies"),
    userId: v.optional(v.id("users")),
    email: v.string(),
    name: v.string(),
    employeeCode: v.string(),
    role: v.union(
      v.literal("company_admin"),
      v.literal("hr_admin"),
      v.literal("manager"),
      v.literal("employee"),
    ),
    departmentId: v.optional(v.id("departments")),
    branchId: v.optional(v.id("branches")),
    position: v.optional(v.string()),
    managerEmail: v.optional(v.string()),
    joinedAt: v.optional(v.number()),
    active: v.boolean(),
    deletedAt: v.optional(v.number()),
  })
    .index("byCompany", ["companyId"])
    .index("byUser", ["userId"])
    .index("byCompanyCode", ["companyId", "employeeCode"])
    .index("byEmail", ["email"]),

  departments: defineTable({
    companyId: v.id("companies"),
    name: v.string(),
  }).index("byCompany", ["companyId"]),

  branches: defineTable({
    companyId: v.id("companies"),
    name: v.string(),
    address: v.optional(v.string()),
    latitude: v.optional(v.number()),
    longitude: v.optional(v.number()),
    geofenceRadiusM: v.optional(v.number()),
  }).index("byCompany", ["companyId"]),

  companySettings: defineTable({
    companyId: v.id("companies"),
    qrRotationSeconds: v.number(),
    requireGeo: v.boolean(),
    autoClockOutHours: v.number(),
    retentionDays: v.number(),
  }).index("byCompany", ["companyId"]),

  registeredDevices: defineTable({
    companyId: v.id("companies"),
    employeeId: v.id("employees"),
    label: v.string(),
    platform: v.string(),
    publicKeyFingerprint: v.string(),
    status: v.union(
      v.literal("active"),
      v.literal("pending_replacement"),
      v.literal("revoked"),
    ),
    registeredAt: v.number(),
    revokedAt: v.optional(v.number()),
  })
    .index("byCompany", ["companyId"])
    .index("byEmployee", ["employeeId"]),

  deviceEvents: defineTable({
    companyId: v.id("companies"),
    deviceId: v.optional(v.id("registeredDevices")),
    employeeId: v.optional(v.id("employees")),
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
  }).index("byCompany", ["companyId", "at"]),

  qrDisplays: defineTable({
    companyId: v.id("companies"),
    branchId: v.optional(v.id("branches")),
    label: v.string(),
    active: v.boolean(),
    createdAt: v.number(),
  }).index("byCompany", ["companyId"]),

  qrTokens: defineTable({
    companyId: v.id("companies"),
    displayId: v.id("qrDisplays"),
    tokenHash: v.string(),
    nonce: v.string(),
    issuedAt: v.number(),
    expiresAt: v.number(),
    consumedAt: v.optional(v.number()),
    consumedBy: v.optional(v.id("employees")),
  })
    .index("byHash", ["tokenHash"])
    .index("byDisplay", ["displayId", "issuedAt"]),

  attendanceSessions: defineTable({
    companyId: v.id("companies"),
    employeeId: v.id("employees"),
    dayKey: v.string(),
    clockInAt: v.number(),
    clockOutAt: v.optional(v.number()),
    breakMinutes: v.number(),
    status: v.union(
      v.literal("present"),
      v.literal("late"),
      v.literal("half_day"),
      v.literal("ongoing"),
      v.literal("holiday"),
      v.literal("weekend"),
      v.literal("on_leave"),
      v.literal("absent"),
    ),
    lateMinutes: v.number(),
    earlyLeaveMinutes: v.number(),
    overtimeMinutes: v.number(),
    workedMinutes: v.optional(v.number()),
    clockInDeviceId: v.optional(v.id("registeredDevices")),
    clockInDisplayId: v.optional(v.id("qrDisplays")),
    clockOutDeviceId: v.optional(v.id("registeredDevices")),
    geoVerified: v.boolean(),
    deletedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("byCompanyDay", ["companyId", "dayKey"])
    .index("byEmployeeDay", ["employeeId", "dayKey"]),

  attendanceEvents: defineTable({
    companyId: v.id("companies"),
    employeeId: v.id("employees"),
    sessionId: v.optional(v.id("attendanceSessions")),
    kind: v.union(
      v.literal("clock_in"),
      v.literal("clock_out"),
      v.literal("break_start"),
      v.literal("break_end"),
      v.literal("auto_clock_out"),
    ),
    at: v.number(),
    dayKey: v.string(),
    deviceId: v.optional(v.id("registeredDevices")),
    displayId: v.optional(v.id("qrDisplays")),
    geoVerified: v.optional(v.boolean()),
  })
    .index("byCompany", ["companyId", "at"])
    .index("bySession", ["sessionId"]),

  leaveTypes: defineTable({
    companyId: v.id("companies"),
    name: v.string(),
    annualQuotaDays: v.number(),
    paid: v.boolean(),
  }).index("byCompany", ["companyId"]),

  leaveRequests: defineTable({
    companyId: v.id("companies"),
    employeeId: v.id("employees"),
    leaveTypeId: v.id("leaveTypes"),
    startDate: v.string(),
    endDate: v.string(),
    reason: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("rejected"),
      v.literal("cancelled"),
    ),
    decidedBy: v.optional(v.string()),
    decidedAt: v.optional(v.number()),
    decisionNote: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("byCompanyStatus", ["companyId", "status"])
    .index("byEmployee", ["employeeId"]),

  leaveBalances: defineTable({
    companyId: v.id("companies"),
    employeeId: v.id("employees"),
    leaveTypeId: v.id("leaveTypes"),
    year: v.number(),
    usedDays: v.number(),
  })
    .index("byEmployee", ["employeeId"])
    .index("byEmployeeTypeYear", ["employeeId", "leaveTypeId", "year"]),

  publicHolidays: defineTable({
    companyId: v.id("companies"),
    date: v.string(),
    name: v.string(),
  }).index("byCompanyDate", ["companyId", "date"]),

  correctionRequests: defineTable({
    companyId: v.id("companies"),
    employeeId: v.id("employees"),
    sessionDate: v.string(),
    requestedClockInAt: v.optional(v.number()),
    requestedClockOutAt: v.optional(v.number()),
    reason: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("rejected"),
    ),
    reviewerNote: v.optional(v.string()),
    reviewedBy: v.optional(v.string()),
    reviewedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("byCompanyStatus", ["companyId", "status"])
    .index("byEmployee", ["employeeId"]),

  notifications: defineTable({
    companyId: v.id("companies"),
    forUserId: v.optional(v.id("users")),
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
    .index("byCompany", ["companyId", "createdAt"])
    .index("byCompanyUnread", ["companyId", "readAt"]),

  auditLogs: defineTable({
    companyId: v.optional(v.id("companies")),
    actorEmail: v.string(),
    action: v.string(),
    detail: v.optional(v.string()),
    at: v.number(),
  }).index("byCompany", ["companyId", "at"]),
});
