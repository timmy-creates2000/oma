import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/AppShell";
import { GlassCard, PageHeader, Empty } from "@/components/glass";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useQuery, useMutation } from "convex/react";
import { toast } from "sonner";
import { Bell, CheckCheck, Plane, Fingerprint, TimerReset, ShieldAlert, Clock3 } from "lucide-react";

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  employee_late: Clock3,
  employee_absent: ShieldAlert,
  forgot_clock_out: Clock3,
  leave_pending: Plane,
  leave_approved: CheckCheck,
  leave_rejected: ShieldAlert,
  device_registered: Fingerprint,
  device_pending: Fingerprint,
  device_change_approved: CheckCheck,
  security_alert: ShieldAlert,
  correction_pending: TimerReset,
  correction_approved: CheckCheck,
  correction_rejected: ShieldAlert,
};

export default function Notifications() {
  const notifications = useQuery(api.platform.myNotifications, { limit: 100 });
  const markRead = useMutation(api.platform.markRead);
  const markAllRead = useMutation(api.platform.markAllRead);

  return (
    <AppShell title="Notifications">
      <PageHeader
        title="Notifications"
        subtitle="Leave decisions, device changes, security alerts and HR events."
        actions={
          <Button
            size="sm" variant="outline" className="glass"
            onClick={async () => {
              try { await markAllRead({}); } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
            }}
          >
            <CheckCheck className="size-4" /> Mark all read
          </Button>
        }
      />

      {!notifications ? (
        <GlassCard className="p-10 text-center text-sm text-muted-foreground">Loading…</GlassCard>
      ) : notifications.length === 0 ? (
        <GlassCard className="p-5"><Empty icon={Bell} text="Nothing here yet." /></GlassCard>
      ) : (
        <div className="space-y-2">
          {notifications.map((n) => {
            const Icon = ICONS[n.type] ?? Bell;
            return (
              <GlassCard key={n._id} className={`flex items-start gap-3.5 p-4 ${n.readAt ? "opacity-60" : ""}`}>
                <div className="glass-inset mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl">
                  <Icon className="size-4.5 text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold">{n.title}</p>
                    {!n.readAt && <Badge className="bg-primary/15 text-primary" variant="secondary">new</Badge>}
                  </div>
                  <p className="mt-0.5 text-sm text-muted-foreground">{n.body}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground/70">{new Date(n.createdAt).toLocaleString()}</p>
                </div>
                {!n.readAt && (
                  <Button
                    size="sm" variant="ghost" className="h-7 shrink-0 text-xs"
                    onClick={async () => { try { await markRead({ id: n._id }); } catch {} }}
                  >
                    Mark read
                  </Button>
                )}
              </GlassCard>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}
