import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireEmployee } from "./helpers";

/** Notifications addressed to me, plus the admin broadcast feed. */
export const listNotifications = query({
  args: {},
  handler: async (ctx) => {
    const employee = await requireEmployee(ctx);
    const identity = await ctx.auth.getUserIdentity();

    const all = await ctx.db
      .query("notifications")
      .withIndex("byCompany", (q) => q.eq("companyId", employee.companyId))
      .collect();

    const visible = all.filter((n) => {
      if (n.forUserId !== undefined) {
        return identity !== null && n.forUserId === identity.subject;
      }
      return n.audience === "admins" || n.audience === "employee";
    });

    return {
      notifications: visible.sort((a, b) => b.createdAt - a.createdAt).slice(0, 100),
      unreadCount: visible.filter((n) => n.readAt === undefined).length,
    };
  },
});

export const markNotificationsRead = mutation({
  args: { notificationIds: v.optional(v.array(v.id("notifications"))) },
  handler: async (ctx, args) => {
    const employee = await requireEmployee(ctx);
    const identity = await ctx.auth.getUserIdentity();
    const now = Date.now();

    const targets = args.notificationIds
      ? await Promise.all(args.notificationIds.map((id) => ctx.db.get(id)))
      : await ctx.db
          .query("notifications")
          .withIndex("byCompany", (q) => q.eq("companyId", employee.companyId))
          .collect();

    let marked = 0;
    for (const notification of targets) {
      if (!notification || notification.companyId !== employee.companyId) continue;
      if (notification.forUserId !== undefined && notification.forUserId !== identity?.subject) {
        continue;
      }
      if (notification.readAt !== undefined) continue;
      await ctx.db.patch(notification._id, { readAt: now });
      marked++;
    }

    return { marked };
  },
});
