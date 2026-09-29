import { AlertTriangle, ChevronDown } from "lucide-react";
import React, { useEffect, useState } from "react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

type GenericError = {
  error: string;
  stack: string;
  filename?: string;
  lineno?: number;
  colno?: number;
  componentStack?: string;
};

function normalizeError(value: unknown): GenericError {
  if (value instanceof Error) {
    return { error: value.message || "Unknown runtime error", stack: value.stack || "" };
  }
  if (typeof value === "string") {
    return { error: value || "Unknown runtime error", stack: "" };
  }
  if (value && typeof value === "object") {
    const c = value as { message?: unknown; error?: unknown; stack?: unknown };
    const message =
      typeof c.message === "string" ? c.message :
      typeof c.error === "string" ? c.error : "";
    return { error: message || "Unknown runtime error", stack: typeof c.stack === "string" ? c.stack : "" };
  }
  return { error: value == null ? "Unknown runtime error" : String(value), stack: "" };
}

function ErrorPanel({ error, onDismiss }: { error: GenericError; onDismiss: () => void }) {
  const technicalDetails = [
    error.filename && `Source: ${error.filename}${error.lineno ? `:${error.lineno}` : ""}${error.colno ? `:${error.colno}` : ""}`,
    error.stack && `Stack trace:\n${error.stack}`,
    error.componentStack && `Component stack:\n${error.componentStack}`,
  ].filter(Boolean).join("\n\n");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-xl border border-zinc-700 bg-zinc-950 p-6 text-zinc-100 shadow-2xl">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-amber-400/10">
            <AlertTriangle className="size-4 text-amber-300" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold">Runtime error</p>
            <p className="mt-1 text-xs text-zinc-400">
              An unexpected error occurred. You can dismiss this and keep browsing.
            </p>
          </div>
        </div>

        <div className="mt-4 rounded-md border border-amber-400/20 bg-amber-400/5 px-3 py-2.5">
          <p className="text-xs font-semibold uppercase tracking-wider text-amber-200/70">Error</p>
          <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-zinc-200">
            {error.error}
          </p>
        </div>

        {technicalDetails && (
          <Collapsible className="mt-3">
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-zinc-400 transition-colors hover:text-zinc-100"
              >
                <ChevronDown className="size-3.5" />
                Show technical details
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md border border-zinc-800 bg-black/30 p-3 font-mono text-[11px] leading-relaxed text-zinc-400">
                {technicalDetails}
              </pre>
            </CollapsibleContent>
          </Collapsible>
        )}

        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-md bg-zinc-100 px-4 py-1.5 text-sm font-medium text-zinc-900 transition-colors hover:bg-white"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}

type ErrorBoundaryState = { hasError: boolean; error: GenericError | null };

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error: normalizeError(error) };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    const componentStack = info.componentStack?.trim();
    this.setState((s) => ({
      error: { ...(s.error ?? normalizeError(error)), componentStack },
    }));
  }

  render() {
    if (this.state.hasError && this.state.error) {
      return (
        <ErrorPanel
          error={this.state.error}
          onDismiss={() => this.setState({ hasError: false, error: null })}
        />
      );
    }
    return this.props.children;
  }
}

export function InstrumentationProvider({ children }: { children: React.ReactNode }) {
  const [error, setError] = useState<GenericError | null>(null);

  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      event.preventDefault();
      const normalized = normalizeError(event.error ?? event.message);
      setError({ ...normalized, filename: event.filename || undefined, lineno: event.lineno || undefined, colno: event.colno || undefined });
    };

    const handleRejection = (event: PromiseRejectionEvent) => {
      const normalized = normalizeError(event.reason);
      console.error("[Runtime error]", normalized.error);
      setError(normalized);
    };

    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleRejection);
    return () => {
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleRejection);
    };
  }, []);

  return (
    <>
      <ErrorBoundary>{children}</ErrorBoundary>
      {error && <ErrorPanel error={error} onDismiss={() => setError(null)} />}
    </>
  );
}
