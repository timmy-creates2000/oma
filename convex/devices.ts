import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import {
  audit,
  can,
  isAdmin,
  notifyAdmins,
  notifyEmployee,
  requireEmployee,
  requirePerm,
} from "./helpers";

/** Admins see the whole fleet, everyone else sees just their own devices. */
export const listDevices = query({
  args: {},
  handler: async (ctx) => {
    const employee = await requireEmployee(ctx);
    const all = isAdmin(employee.role);

    const devices = all
      ? await ctx.db
          .query("registeredDevices")
          .withIndex("byCompany", (q) => q.eq("companyId", employee.companyId))
          .collect()
      : await ctx.db
          .query("registeredDevices")
          .withIndex("byEmployee", (q) => q.eq("employeeId", employee._id))
          .collect();

    const ownerIds = [...new Set(devices.map((d) => d.employeeId))];
    const owners = new Map<Id<"employees">, string>();
    for (const ownerId of ownerIds) {
      const owner = await ctx.db.get(ownerId);
      if (owner) owners.set(ownerId, owner.name);
    }

    const events = all
      ? await ctx.db
          .query("deviceEvents")
          .withIndex("byCompany", (q) => q.eq("companyId", employee.companyId))
          .collect()
      : (
          await ctx.db
            .query("deviceEvents")
            .withIndex("byCompany", (q) => q.eq("companyId", employee.companyId))
            .collect()
        ).filter((e) => e.employeeId === employee._id);

    return {
      devices: devices
        .map((d) => ({ ...d, ownerName: owners.get(d.employeeId) ?? "Unknown" }))
        .sort((a, b) => b.registeredAt - a.registeredAt),
      events: events.sort((a, b) => b.at - a.at).slice(0, 50),
      canDecide: can(employee.role, "approve_devices"),
    };
  },
});

/** An employee registers the device they scan with. One active device each. */
export const registerDevice = mutation({
  args: {
    label: v.string(),
    platform: v.string(),
    publicKeyFingerprint: v.string(),
  },
  handler: async (ctx, args) => {
    const employee = await requireEmployee(ctx);
    const existing = await ctx.db
      .query("registeredDevices")
      .withIndex("byEmployee", (q) => q.eq("employeeId", employee._id))
      .collect();
    if (existing.some((d) => d.status === "active")) {
      throw new Error(
        "You already have an active device. Request a replacement to swap it.",
      );
    }

    const now = Date.now();
    const deviceId = await ctx.db.insert("registeredDevices", {
      companyId: employee.companyId,
      employeeId: employee._id,
      label: args.label,
      platform: args.platform,
      publicKeyFingerprint: args.publicKeyFingerprint,
      status: "active",
      registeredAt: now,
    });

    await ctx.db.insert("deviceEvents", {
      companyId: employee.companyId,
      deviceId,
      employeeId: employee._id,
      type: "registered",
      detail: `${args.label} (${args.platform})`,
      actor: employee.email,
      at: now,
    });
    await audit(ctx, employee.companyId, "device.registered", args.label);

    return { deviceId };
  },
});

/** Flags the current device as awaiting a replacement decision. */
export const requestReplacement = mutation({
  args: { reason: v.string() },
  handler: async (ctx, args) => {
    const employee = await requireEmployee(ctx);
    const device = await ctx.db
      .query("registeredDevices")
      .withIndex("byEmployee", (q) => q.eq("employeeId", employee._id))
      .filter((q) => q.eq(q.field("status"), "active"))
      .first();
    if (!device) throw new Error("You have no active device to replace");

    const now = Date.now();
    await ctx.db.patch(device._id, { status: "pending_replacement" });
    await ctx.db.insert("deviceEvents", {
      companyId: employee.companyId,
      deviceId: device._id,
      employeeId: employee._id,
      type: "replacement_requested",
      detail: args.reason,
      actor: employee.email,
      at: now,
    });
    await notifyAdmins(
      ctx,
      employee.companyId,
      "device",
      "Device replacement requested",
      `${employee.name} asked to replace "${device.label}".`,
    );
    await audit(ctx, employee.companyId, "device.replacement_requested", args.reason);

    return { ok: true };
  },
});

/** Approving revokes the old device; rejecting puts it straight back to active. */
export const decideReplacement = mutation({
  args: { deviceId: v.id("registeredDevices"), approve: v.boolean() },
  handler: async (ctx, args) => {
    const admin = await requirePerm(ctx, "approve_devices");
    const device = await ctx.db.get(args.deviceId);
    if (!device || device.companyId !== admin.companyId) {
      throw new Error("That device does not belong to your company");
    }
    if (device.status !== "pending_replacement") {
      throw new Error("That device is not waiting for a decision");
    }

    const now = Date.now();
    await ctx.db.patch(device._id, {
      status: args.approve ? "revoked" : "active",
      revokedAt: args.approve ? now : undefined,
    });
    await ctx.db.insert("deviceEvents", {
      companyId: admin.companyId,
      deviceId: device._id,
      employeeId: device.employeeId,
      type: "replacement_approved",
      detail: args.approve ? "Replacement approved" : "Replacement declined",
      actor: admin.email,
      at: now,
    });

    const owner = await ctx.db.get(device.employeeId);
    if (owner) {
      await notifyEmployee(
        ctx,
        admin.companyId,
        owner,
        "device",
        args.approve ? "Device replacement approved" : "Device replacement declined",
        args.approve
          ? 'Your old device was revoked. Register the new one from the Devices page.'
          : 'Your existing device stays active. No further action needed.',
      );
    }
    await audit(
      ctx,
      admin.companyId,
      args.approve ? "device.replacement_approved" : "device.replacement_declined",
      device.label,
    );

    return { ok: true };
  },
});

export const revokeDevice = mutation({
  args: { deviceId: v.id("registeredDevices") },
  handler: async (ctx, args) => {
    const admin = await requirePerm(ctx, "manage_devices");
    const device = await ctx.db.get(args.deviceId);
    if (!device || device.companyId !== admin.companyId) {
      throw new Error("That device does not belong to your company");
    }

    const now = Date.now();
    await ctx.db.patch(device._id, { status: "revoked", revokedAt: now });
    await ctx.db.insert("deviceEvents", {
      companyId: admin.companyId,
      deviceId: device._id,
      employeeId: device.employeeId,
      type: "revoked",
      detail: device.label,
      actor: admin.email,
      at: now,
    });
    await audit(ctx, admin.companyId, "device.revoked", device.label);

    return { ok: true };
  },
});

export const reactivateDevice = mutation({
  args: { deviceId: v.id("registeredDevices") },
  handler: async (ctx, args) => {
    const admin = await requirePerm(ctx, "manage_devices");
    const device = await ctx.db.get(args.deviceId);
    if (!device || device.companyId !== admin.companyId) {
      throw new Error("That device does not belong to your company");
    }

    await ctx.db.patch(device._id, { status: "active", revokedAt: undefined });
    await ctx.db.insert("deviceEvents", {
      companyId: admin.companyId,
      deviceId: device._id,
      employeeId: device.employeeId,
      type: "replacement_approved",
      detail: `${device.label} reactivated`,
      actor: admin.email,
      at: Date.now(),
    });
    await audit(ctx, admin.companyId, "device.reactivated", device.label);

    return { ok: true };
  },
});
