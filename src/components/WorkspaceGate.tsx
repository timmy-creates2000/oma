import { lazy, Suspense, type ReactNode } from "react";
import { useWorkspace } from "@/hooks/use-workspace";
import { useSupabaseAuth } from "@/hooks/use-supabase-auth";
import { Loader2 } from "lucide-react";

const Onboarding = lazy(() => import("@/pages/Onboarding"));

/**
 * Signed-in users without a company profile see the onboarding flow;
 * users with a workspace pass through to the requested page.
 */
export function WorkspaceGate({ children }: { children: ReactNode }) {
  const { user } = useSupabaseAuth();
  const { ws, loading } = useWorkspace();

  if (!user || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!ws) {
    return (
      <Suspense fallback={
        <div className="flex min-h-screen items-center justify-center">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      }>
        <Onboarding />
      </Suspense>
    );
  }

  return <>{children}</>;
}
