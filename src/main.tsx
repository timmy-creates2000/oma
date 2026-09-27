import '@vly-ai/integrations';
import { Toaster } from "@/components/ui/sonner";
import { RequireAuth } from "@/components/RequireAuth";
import { VlyToolbar } from "../vly-toolbar-readonly.tsx";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ConvexReactClient } from "convex/react";
import React, { StrictMode, useEffect, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes, useLocation } from "react-router";
import "./index.css";

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

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string);

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

/** Signed-in users without a workspace go to onboarding; the dashboard
 *  itself is only rendered once a company exists. */
function WorkspaceGate({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuth redirectImmediately>
      <OnboardingGate>{children}</OnboardingGate>
    </RequireAuth>
  );
}

// Rendered inside RequireAuth so `ws` reflects the signed-in user only.
import { api } from "@/convex/_generated/api";
import { useQuery } from "convex/react";
function OnboardingGate({ children }: { children: React.ReactNode }) {
  const ws = useQuery(api.workspace.get);
  if (ws === undefined) return <RouteLoading />;
  if (ws === null) return <Onboarding />;
  return <>{children}</>;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RootErrorBoundary>
      <ToolbarErrorBoundary>
        <VlyToolbar />
      </ToolbarErrorBoundary>
      <ConvexAuthProvider client={convex}>
        <BrowserRouter>
          <RouteSyncer />
          <Suspense fallback={<RouteLoading />}>
            <Routes>
              <Route path="/" element={<Landing />} />
              <Route
                path="/auth"
                element={<AuthPage redirectAfterAuth="/dashboard" />}
              />
              <Route
                path="/dashboard"
                element={<WorkspaceGate><Dashboard /></WorkspaceGate>}
              />
              <Route
                path="/me"
                element={<WorkspaceGate><MyWorkspace /></WorkspaceGate>}
              />
              <Route
                path="/live"
                element={<WorkspaceGate><LiveAttendance /></WorkspaceGate>}
              />
              <Route
                path="/employees"
                element={<WorkspaceGate><Employees /></WorkspaceGate>}
              />
              <Route
                path="/employees/:id"
                element={<WorkspaceGate><EmployeeDetail /></WorkspaceGate>}
              />
              <Route
                path="/attendance-admin"
                element={<WorkspaceGate><AttendanceAdmin /></WorkspaceGate>}
              />
              <Route
                path="/leave-admin"
                element={<WorkspaceGate><LeaveAdmin /></WorkspaceGate>}
              />
              <Route
                path="/corrections"
                element={<WorkspaceGate><Corrections /></WorkspaceGate>}
              />
              <Route
                path="/devices"
                element={<WorkspaceGate><Devices /></WorkspaceGate>}
              />
              <Route
                path="/qr"
                element={<WorkspaceGate><QrDisplays /></WorkspaceGate>}
              />
              <Route
                path="/kiosk"
                element={
                  <RequireAuth redirectImmediately>
                    <OnboardingGate><Kiosk /></OnboardingGate>
                  </RequireAuth>
                }
              />
              <Route
                path="/analytics"
                element={<WorkspaceGate><Analytics /></WorkspaceGate>}
              />
              <Route
                path="/reports"
                element={<WorkspaceGate><Reports /></WorkspaceGate>}
              />
              <Route
                path="/notifications"
                element={<WorkspaceGate><Notifications /></WorkspaceGate>}
              />
              <Route
                path="/audit"
                element={<WorkspaceGate><AuditLogs /></WorkspaceGate>}
              />
              <Route
                path="/settings"
                element={<WorkspaceGate><Settings /></WorkspaceGate>}
              />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
        <Toaster />
      </ConvexAuthProvider>
    </RootErrorBoundary>
  </StrictMode>,
)
