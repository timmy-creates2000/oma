import { v } from "convex/values";
import { query } from "./_generated/server";
import { requirePerm } from "./helpers";

/** The immutable activity trail for the company. */
export const listAudit = query({
  args: {
    limit: v.optional(v.number()),
    search: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const admin = await requirePerm(ctx, "view_audit");
    const limit = Math.min(args.limit ?? 200, 500);

    const entries = await ctx.db
      .query("auditLogs")
      .withIndex("byCompany", (q) => q.eq("companyId", admin.companyId))
      .collect();

    const search = args.search?.trim().toLowerCase();
    return entries
      .filter(
        (e) =>
          search
            ? e.action.toLowerCase().includes(search) ||
              e.actorEmail.toLowerCase().includes(search) ||
              (e.detail ?? "").toLowerCase().includes(search)
            : true,
      )
      .sort((a, b) => b.at - a.at)
      .slice(0, limit);
  },
});
