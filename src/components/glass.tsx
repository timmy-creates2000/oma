import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function GlassCard({
  children,
  className,
  strong = false,
}: {
  children?: ReactNode;
  className?: string;
  strong?: boolean;
}) {
  return (
    <div
      className={cn(
        "glass glass-edge relative overflow-hidden rounded-2xl",
        strong && "glass-strong",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function StatTile({
  icon: Icon,
  label,
  value,
  tone = "text-primary",
  hint,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: ReactNode;
  tone?: string;
  hint?: string;
}) {
  return (
    <GlassCard className="p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          <p className={cn("mt-1 text-2xl font-bold tracking-tight", tone)}>{value}</p>
          {hint ? <p className="mt-0.5 text-[11px] text-muted-foreground/80">{hint}</p> : null}
        </div>
        <div className="glass-inset flex size-9 shrink-0 items-center justify-center rounded-xl">
          <Icon className="size-4.5" />
        </div>
      </div>
    </GlassCard>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle ? <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Empty({ icon: Icon, text }: { icon: React.ComponentType<{ className?: string }>; text: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
      <div className="glass-inset flex size-12 items-center justify-center rounded-2xl">
        <Icon className="size-5 text-muted-foreground" />
      </div>
      <p className="text-sm text-muted-foreground">{text}</p>
    </div>
  );
}
