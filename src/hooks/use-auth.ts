import { useSupabaseAuth } from "./use-supabase-auth";

/**
 * App-wide auth hook backed by Supabase password auth.
 */
export function useSession() {
  const { loading, user, signIn, signUp, signOut } = useSupabaseAuth();

  return {
    isLoading: loading,
    isAuthenticated: !!user,
    user: user ?? null,
    signIn,
    signUp,
    signOut,
  };
}

/** Convenience wrapper for the four workspace roles. */
export type Role = "company_admin" | "hr_admin" | "manager" | "employee";
