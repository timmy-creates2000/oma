import { useSupabaseAuth } from "./use-supabase-auth";

/**
 * One hook for the whole app's auth state backed by Supabase Auth.
 */
export function useSession() {
  const { loading, user, signOut } = useSupabaseAuth();

  return {
    isLoading: loading,
    isAuthenticated: !!user,
    user: user ?? null,
    signOut,
  };
}

/** Convenience wrapper for the four workspace roles. */
export type Role = "company_admin" | "hr_admin" | "manager" | "employee";
