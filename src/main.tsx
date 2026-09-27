import '@vly-ai/integrations';
import { Toaster } from "@/components/ui/sonner";
import { VlyToolbar } from "../vly-toolbar-readonly.tsx";
import React, { StrictMode, useEffect, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes, useLocation } from "react-router";
import "./index.css";
import { SupabaseAuthProvider } from "@/hooks/use-supabase-auth";
import { hasSupabaseCreds } from "@/lib/sb";

// Lazy load route components for better code splitting
const Landing = lazy(() => import("./pages/Landing.tsx"));
const AuthPage = lazy(() => import("./pages/Auth.tsx"));
const Onboarding = lazy(() => import("./pages/Onboarding.tsx"));
const Dashboard = lazy(() => import("./pages/Dashboard.tsx"));
const MyWorkspace = lazy(() => import("./pages/MyWorkspace.tsx"));
const LiveAttendance = lazy(() => import("./pages/LiveAttendance.tsx"));
const Employees = lazy(() => import("./pages/Employees.tsx"));
const EmployeeDetail = lazy(() => import("./pages/EmployeeDetail.tsx"));
const AttendanceAdmin = lazy(() => import("./pages/AttendanceAdmin.tsx"));
const LeaveAdmin = lazy(() => import("./pages/LeaveAdmin.tsx"));
const Corrections = lazy(() => import("./pages/Corrections.tsx"));
const Devices = lazy(() => import("./pages/Devices.tsx"));
const QrDisplays = lazy(() => import("./pages/QrDisplays.tsx"));
const Kiosk = lazy(() => import("./pages/Kiosk.tsx"));
const Analytics = lazy(() => import("./pages/Analytics.tsx"));
const Reports = lazy(() => import("./pages/Reports.tsx"));
const Notifications = lazy(() => import("./pages/Notifications.tsx"));
const AuditLogs = lazy(() => import("./pages/AuditLogs.tsx"));
const Settings = lazy(() => import("./pages/Settings.tsx"));
const NotFound = lazy(() => import("./pages/NotFound.tsx"));

// Simple loading fallback for route transitions
function RouteLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="animate-pulse text-muted-foreground">Loading…</div>
    </div>
  );
}

/** Silent error boundary — if VlyToolbar crashes it renders nothing instead of
 *  crashing the whole app (e.g. hook errors in the browser runtime). */
class ToolbarErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(err: Error) {
    console.warn("[VlyToolbar] Caught error, toolbar disabled:", err.message);
  }
  render() {
    return this.state.hasError ? null : this.props.children;
  }
}

/** Hard guard so runtime errors never leave the preview as a blank page. */
class RootErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; message: string; stack: string }
> {
  state = { hasError: false, message: "", stack: "" };
  static getDerivedStateFromError(error: Error) {
    return {
      hasError: true,
      message: error.message || "Unknown runtime error",
      stack: error.stack || "",
    };
  }
  componentDidCatch(err: Error) {
    console.error("[Preview] Root crash:", err);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
          <div className="max-w-lg text-center">
            <p className="text-sm font-semibold">Preview runtime error</p>
            <p className="mt-2 break-words text-xs text-muted-foreground">
              {this.state.message}
            </p>
            {this.state.stack && (
              <pre className="mt-3 max-h-40 overflow-auto rounded border border-border/60 p-2 text-left text-[10px] leading-4 text-muted-foreground/80">
                {this.state.stack}
              </pre>
            )}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function RouteSyncer() {
  const location = useLocation();
  useEffect(() => {
    window.parent.postMessage(
      { type: "iframe-route-change", path: location.pathname },
      "*",
    );
  }, [location.pathname]);

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.data?.type === "navigate") {
        if (event.data.direction === "back") window.history.back();
        if (event.data.direction === "forward") window.history.forward();
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  return null;
}

function MissingCredsNotice() {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="glass-strong glass-edge max-w-md rounded-3xl p-8 text-center">
        <h1 className="text-lg font-bold">Supabase keys needed</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          OfficeFlow is now powered by Supabase. Add{" "}
          <code className="rounded bg-white/60 px-1.5 py-0.5 font-mono text-xs">VITE_SUPABASE_URL</code>{" "}
          and{" "}
          <code className="rounded bg-white/60 px-1.5 py-0.5 font-mono text-xs">VITE_SUPABASE_ANON_KEY</code>{" "}
          in the Keys/API keys tab, and run the three SQL files in{" "}
          <code className="rounded bg-white/60 px-1.5 py-0.5 font-mono text-xs">supabase/</code>{" "}
          in the Supabase SQL editor, then reload.
        </p>
      </div>
    </div>
  );
}

/** Signed-in users without a workspace land on onboarding. */
function OnboardingGate({ children }: { children: React.ReactNode }) {
  const Onboard = lazy(() => import("./pages/Onboarding.tsx"));
  return <>{children}</>;
}
void OnboardingGate;

const gate = (node: React.ReactNode) => <RequireAuthGate>{node}</RequireAuthGate>;

function RequireAuthGate({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuth redirectImmediately>
      <WorkspaceGate>{children}</WorkspaceGate>
    </RequireAuth>
  );
}

// WorkspaceGate lives in its own file to keep imports tidy.
import { RequireAuth } from "@/components/RequireAuth";
import { WorkspaceGate } from "@/components/WorkspaceGate";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RootErrorBoundary>
      <ToolbarErrorBoundary>
        <VlyToolbar />
      </ToolbarErrorBoundary>
      <SupabaseAuthProvider>
        {hasSupabaseCreds ? (
          <BrowserRouter>
            <RouteSyncer />
            <Suspense fallback={<RouteLoading />}>
              <Routes>
                <Route path="/" element={<Landing />} />
                <Route path="/auth" element={<AuthPage redirectAfterAuth="/dashboard" />} />
                <Route path="/dashboard" element={gate(<Dashboard />)} />
                <Route path="/me" element={gate(<MyWorkspace />)} />
                <Route path="/live" element={gate(<LiveAttendance />)} />
                <Route path="/employees" element={gate(<Employees />)} />
                <Route path="/employees/:id" element={gate(<EmployeeDetail />)} />
                <Route path="/attendance-admin" element={gate(<AttendanceAdmin />)} />
                <Route path="/leave-admin" element={gate(<LeaveAdmin />)} />
                <Route path="/corrections" element={gate(<Corrections />)} />
                <Route path="/devices" element={gate(<Devices />)} />
                <Route path="/qr" element={gate(<QrDisplays />)} />
                <Route path="/kiosk" element={gate(<Kiosk />)} />
                <Route path="/analytics" element={gate(<Analytics />)} />
                <Route path="/reports" element={gate(<Reports />)} />
                <Route path="/notifications" element={gate(<Notifications />)} />
                <Route path="/audit" element={gate(<AuditLogs />)} />
                <Route path="/settings" element={gate(<Settings />)} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          </BrowserRouter>
        ) : (
          <MissingCredsNotice />
        )}
        <Toaster />
      </SupabaseAuthProvider>
    </RootErrorBoundary>
  </StrictMode>,
)
