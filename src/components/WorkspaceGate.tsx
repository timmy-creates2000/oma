import { lazy, Suspense, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { useWorkspace } from "@/hooks/use-workspace";

const Onboarding = lazy(() => import("@/pages/Onboarding"));

function FullScreenSpinner() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
    </div>
  );
}

/**
 * Signed-in users without a company profile see the onboarding flow;
 * users with a workspace pass through to the requested page.
 */
export function WorkspaceGate({ children }: { children: ReactNode }) {
  const { ws, loading } = useWorkspace();

  // undefined = loading, an error means "signed in but not in a company yet".
  if (loading) return <FullScreenSpinner />;

  if (ws === null) {
    return (
      <Suspense fallback={<FullScreenSpinner />}>
        <Onboarding />
      </Suspense>
    );
  }

  return <>{children}</>;
}
