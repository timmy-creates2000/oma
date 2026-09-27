import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";

/**
 * Convex Auth with the Password (email + password) provider.
 *
 * `signIn("password", { flow: "signUp" | "signIn", email, password })` drives
 * both registration and login, so the Auth page uses one call with a flow arg.
 * The `users` / `sessions` / `accounts` tables come from `authTables` in
 * schema.ts.
 */
export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [Password],
});
