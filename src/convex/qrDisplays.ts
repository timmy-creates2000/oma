import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { audit, requirePerm, requireWorkspace } from "./helpers";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const ws = await requireWorkspace(ctx);
    const rows = await ctx.db
      .query("qrDisplays")
      .withIndex("by_company", (q) => q.eq("companyId", ws.company._id))
      .collect();
    const branches = await ctx.db.query("branches")
      .withIndex("by_company", (q) => q.eq("companyId", ws.company._id)).collect();
    const brById = new Map(branches.map((b) => [b._id, b]));
    return rows
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((d) => ({ ...d, branchName: d.branchId ? brById.get(d.branchId)?.name ?? null : "All branches" }));
  },
});

export const create = mutation({
  args: { label: v.string(), branchId: v.optional(v.id("branches")) },
  handler: async (ctx, args) => {
    const ws = await requireWorkspace(ctx);
    requirePerm(ws, "manage_qr");
    const id = await ctx.db.insert("qrDisplays", {
      companyId: ws.company._id,
      branchId: args.branchId,
      label: args.label.trim(),
      active: true,
      createdAt: Date.now(),
    });
    await audit(ctx, ws, "qr_display.created", args.label);
    return { id };
  },
});

export const toggleActive = mutation({
  args: { id: v.id("qrDisplays") },
  handler: async (ctx, args) => {
    const ws = await requireWorkspace(ctx);
    requirePerm(ws, "manage_qr");
    const d = await ctx.db.get(args.id);
    if (!d || d.companyId !== ws.company._id) throw new Error("Not found");
    await ctx.db.patch(args.id, { active: !d.active });
    await audit(ctx, ws, "qr_display.toggled", `${d.label} → ${!d.active ? "active" : "inactive"}`);
    return { ok: true };
  },
});

export const remove = mutation({
  args: { id: v.id("qrDisplays") },
  handler: async (ctx, args) => {
    const ws = await requireWorkspace(ctx);
    requirePerm(ws, "manage_qr");
    const d = await ctx.db.get(args.id);
    if (!d || d.companyId !== ws.company._id) throw new Error("Not found");
    await ctx.db.delete(args.id);
    await audit(ctx, ws, "qr_display.deleted", d.label);
    return { ok: true };
  },
});
