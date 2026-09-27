import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { DEVICE_STATUS } from "./schema";
import { audit, notify, requirePerm, requireWorkspace, sha256Hex } from "./helpers";

/* --------------------------------- queries --------------------------------- */

export const myDevices = query({
  args: {},
  handler: async (ctx) => {
    const ws = await requireWorkspace(ctx);
    return await ctx.db
      .query("registeredDevices")
      .withIndex("by_employee", (q) => q.eq("employeeId", ws.employee._id))
      .collect();
  },
});

export const companyDevices = query({
  args: {},
  handler: async (ctx) => {
    const ws = await requireWorkspace(ctx);
    requirePerm(ws, "manage_devices");
    const rows = await ctx.db
      .query("registeredDevices")
      .withIndex("by_company", (q) => q.eq("companyId", ws.company._id))
      .collect();
    const employees = await ctx.db.query("employees")
      .withIndex("by_company", (q) => q.eq("companyId", ws.company._id)).collect();
    const empById = new Map(employees.map((e) => [e._id, e]));
    const events = await ctx.db.query("deviceEvents")
      .withIndex("by_company", (q) => q.eq("companyId", ws.company._id))
      .order("desc").take(40);
    return {
      devices: rows
        .sort((a, b) => b.registeredAt - a.registeredAt)
        .map((d) => ({ ...d, employee: empById.get(d.employeeId) ?? null })),
      events,
    };
  },
});

/* -------------------------------- mutations -------------------------------- */

/** Employee registers a device. Simulates device-bound keypair: only a
 *  fingerprint of the public key is stored, never any private material. */
export const register = mutation({
  args: { label: v.string(), platform: v.string(), publicKeyMock: v.string() },
  handler: async (ctx, args) => {
    const ws = await requireWorkspace(ctx);
    const fingerprint = (await sha256Hex(args.publicKeyMock)).slice(0, 32);
    const dup = await ctx.db
      .query("registeredDevices")
      .withIndex("by_fingerprint", (q) => q.eq("publicKeyFingerprint", fingerprint))
      .first();
    if (dup && dup.status === DEVICE_STATUS.ACTIVE) {
      throw new Error("This device is already registered.");
    }
    const activeCount = (await ctx.db
      .query("registeredDevices")
      .withIndex("by_employee", (q) => q.eq("employeeId", ws.employee._id))
      .collect()).filter((d) => d.status === DEVICE_STATUS.ACTIVE).length;
    if (activeCount >= 2) throw new Error("Device policy: max 2 active devices per employee.");

    const id = await ctx.db.insert("registeredDevices", {
      companyId: ws.company._id,
      employeeId: ws.employee._id,
      label: args.label.trim() || "My device",
      platform: args.platform,
      publicKeyFingerprint: fingerprint,
      status: DEVICE_STATUS.ACTIVE,
      registeredAt: Date.now(),
    });
    await ctx.db.insert("deviceEvents", {
      companyId: ws.company._id, deviceId: id, employeeId: ws.employee._id,
      type: "registered", detail: `${args.platform} · ${args.label}`,
      actor: ws.employee.email, at: Date.now(),
    });
    await notify(ctx, {
      companyId: ws.company._id, audience: "admins", type: "device_registered",
      title: "New device registered",
      body: `${ws.employee.name} registered ${args.label} (${args.platform}).`,
    });
    await audit(ctx, ws, "device.registered", `${ws.employee.email}: ${args.label}`);
    return { id };
  },
});

export const requestReplacement = mutation({
  args: { deviceId: v.id("registeredDevices"), reason: v.string() },
  handler: async (ctx, args) => {
    const ws = await requireWorkspace(ctx);
    const device = await ctx.db.get(args.deviceId);
    if (!device || device.employeeId !== ws.employee._id) throw new Error("Device not found");
    await ctx.db.patch(args.deviceId, { status: DEVICE_STATUS.PENDING_REPLACEMENT });
    await ctx.db.insert("deviceEvents", {
      companyId: ws.company._id, deviceId: device._id, employeeId: ws.employee._id,
      type: "replacement_requested", detail: args.reason,
      actor: ws.employee.email, at: Date.now(),
    });
    await notify(ctx, {
      companyId: ws.company._id, audience: "admins", type: "device_pending",
      title: "Device replacement requested",
      body: `${ws.employee.name}: ${args.reason}`,
    });
    await audit(ctx, ws, "device.replacement_requested", `${ws.employee.email}: ${args.reason}`);
    return { ok: true };
  },
});

export const decideReplacement = mutation({
  args: { deviceId: v.id("registeredDevices"), approve: v.boolean() },
  handler: async (ctx, args) => {
    const ws = await requireWorkspace(ctx);
    requirePerm(ws, "approve_devices");
    const device = await ctx.db.get(args.deviceId);
    if (!device || device.companyId !== ws.company._id) throw new Error("Device not found");
    if (device.status !== DEVICE_STATUS.PENDING_REPLACEMENT) {
      throw new Error("This device has no pending replacement request.");
    }
    if (args.approve) {
      await ctx.db.patch(args.deviceId, { status: DEVICE_STATUS.REVOKED, revokedAt: Date.now() });
      await ctx.db.insert("deviceEvents", {
        companyId: ws.company._id, deviceId: device._id, employeeId: device.employeeId,
        type: "replacement_approved", detail: "Old device revoked — employee can register a new one",
        actor: ws.user.email ?? "HR", at: Date.now(),
      });
    } else {
      await ctx.db.patch(args.deviceId, { status: DEVICE_STATUS.ACTIVE });
      await ctx.db.insert("deviceEvents", {
        companyId: ws.company._id, deviceId: device._id, employeeId: device.employeeId,
        type: "replacement_requested", detail: "Replacement rejected — device stays active",
        actor: ws.user.email ?? "HR", at: Date.now(),
      });
    }
    const emp = await ctx.db.get(device.employeeId);
    await notify(ctx, {
      companyId: ws.company._id, audience: "employee",
      forUserId: emp?.userId,
      type: args.approve ? "device_change_approved" : "device_change_rejected",
      title: args.approve ? "Device replacement approved" : "Device replacement rejected",
      body: args.approve
        ? "Your old device was revoked. You can now register a replacement."
        : "Your replacement request was rejected; keep using your current device.",
    });
    await audit(ctx, ws, args.approve ? "device.replacement_approved" : "device.replacement_rejected", device.label);
    return { ok: true };
  },
});

export const revoke = mutation({
  args: { deviceId: v.id("registeredDevices"), reason: v.string() },
  handler: async (ctx, args) => {
    const ws = await requireWorkspace(ctx);
    requirePerm(ws, "manage_devices");
    const device = await ctx.db.get(args.deviceId);
    if (!device || device.companyId !== ws.company._id) throw new Error("Device not found");
    await ctx.db.patch(args.deviceId, { status: DEVICE_STATUS.REVOKED, revokedAt: Date.now() });
    await ctx.db.insert("deviceEvents", {
      companyId: ws.company._id, deviceId: device._id, employeeId: device.employeeId,
      type: "revoked", detail: args.reason || "Revoked by admin",
      actor: ws.user.email ?? "admin", at: Date.now(),
    });
    const emp = await ctx.db.get(device.employeeId);
    await notify(ctx, {
      companyId: ws.company._id, audience: "employee",
      forUserId: emp?.userId,
      type: "security_alert", title: "Device revoked",
      body: `Your device "${device.label}" was revoked by HR.`,
    });
    await audit(ctx, ws, "device.revoked", `${device.label} — ${args.reason}`);
    return { ok: true };
  },
});

export const reactivate = mutation({
  args: { deviceId: v.id("registeredDevices") },
  handler: async (ctx, args) => {
    const ws = await requireWorkspace(ctx);
    requirePerm(ws, "manage_devices");
    const device = await ctx.db.get(args.deviceId);
    if (!device || device.companyId !== ws.company._id) throw new Error("Device not found");
    await ctx.db.patch(args.deviceId, { status: DEVICE_STATUS.ACTIVE, revokedAt: undefined });
    await audit(ctx, ws, "device.reactivated", device.label);
    return { ok: true };
  },
});
