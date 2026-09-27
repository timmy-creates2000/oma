import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";

/**
 * Convex Auth with the Password (email + password) provider.
 *
 * `signIn("password", { flow: "signUp" | "signIn", email, password })` drives
 * both registration and login, so the Auth page uses one call with a flow arg.
 * The `users` / `sessions` / `accounts` tables come from `authTables` in
 * schema.ts.
 *
 * The custom claims matter: without them the JWT only carries `sub`, so
 * `ctx.auth.getUserIdentity().email` is null and nothing can match a signed-in
 * user to an employee record.
 */
export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [Password],
  jwt: {
    customClaims: async (ctx, { userId }) => {
      const user = await ctx.db.get(userId);
      if (!user) return {};
      return {
        email: user.email,
        name: user.name ?? undefined,
      };
    },
  },
});
