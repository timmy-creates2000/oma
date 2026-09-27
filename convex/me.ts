import { query } from "./_generated/server";

/**
 * The signed-in Convex Auth identity, or null. Kept separate from myWorkspace
 * so the client can render the signed-in shell before a company is chosen.
 */
export const currentUser = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    return {
      id: identity.subject,
      email: identity.email ?? null,
      name: identity.name ?? null,
    };
  },
});
