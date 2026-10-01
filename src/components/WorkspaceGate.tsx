import { lazy, Suspense, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSession } from "@/hooks/use-auth";
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
  const { ws, loading, error, refresh } = useWorkspace();
  const { signOut } = useSession();

  if (loading) return <FullScreenSpinner />;

  // A connection or database error must not look like "no company yet".
  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-sm font-semibold">We could not load your workspace</p>
        <p className="max-w-sm text-xs text-muted-foreground">{error}</p>
        <div className="flex gap-2">
          <Button onClick={refresh}>Try again</Button>
          <Button variant="outline" onClick={() => signOut()}>Sign out</Button>
        </div>
      </div>
    );
  }

  if (ws === null) {
    return (
      <Suspense fallback={<FullScreenSpinner />}>
        <Onboarding />
      </Suspense>
    );
  }

  return <>{children}</>;
}
