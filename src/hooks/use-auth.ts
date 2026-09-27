import { useAuthActions, useConvexAuth } from "@convex-dev/auth/react";
import { useQuery } from "convex/react";
import { api } from "@/lib/api";

/**
 * One hook for the whole app's auth state: Convex Auth owns the session, and
 * `me.currentUser` resolves the identity for display.
 */
export function useSession() {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const user = useQuery(api.me.currentUser);
  const { signIn, signOut } = useAuthActions();

  return {
    isLoading: isLoading || user === undefined,
    isAuthenticated,
    user: user ?? null,
    signIn,
    signOut,
  };
}

/** Convenience wrapper for the four workspace roles. */
export type Role = "company_admin" | "hr_admin" | "manager" | "employee";
