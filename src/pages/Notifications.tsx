import { AppShell } from "@/components/AppShell";
import { GlassCard, PageHeader, Empty } from "@/components/glass";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Bell, CheckCheck, Plane, Fingerprint, TimerReset, ShieldAlert, Clock3, Loader2 } from "lucide-react";
import { supabase, err, type Notification } from "@/lib/sb";
import { useWorkspace } from "@/hooks/use-workspace";
import { useNavigate } from "react-router";
import { notifRoute } from "@/lib/notif-routes";
import { useSupabaseAuth } from "@/hooks/use-supabase-auth";

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
  early_clockout_pending: TimerReset,
  early_clockout_approved: CheckCheck,
  early_clockout_rejected: ShieldAlert,
};

export default function Notifications() {
  const { ws } = useWorkspace();
  const { user } = useSupabaseAuth();
  const navigate = useNavigate();
  const isAdmin = ws?.employee.role !== "employee";
  const [rows, setRows] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!ws) return;
    (async () => {
      const { data } = await supabase
        .from("notifications")
        .select("*")
        .eq("company_id", ws.employee.company_id)
        .order("created_at", { ascending: false })
        .limit(100);
      setRows((data ?? []) as unknown as Notification[]);
      setLoading(false);
    })();
  }, [ws, user?.id]);

  const markAll = async () => {
    try {
      await supabase.rpc("mark_notifications_read", { p_all: true });
      setRows((prev) => prev.map((n) => ({ ...n, read_at: new Date().toISOString() })));
    } catch (e) {
      toast.error(err(e));
    }
  };

  const markOne = async (id: string) => {
    try {
      await supabase.rpc("mark_notifications_read", { p_all: false, p_id: id });
      setRows((prev) => prev.map((n) => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n)));
    } catch (e) {
      toast.error(err(e));
    }
  };

  const open = async (n: Notification) => {
    if (!n.read_at) await markOne(n.id);
    const to = notifRoute(n.type, isAdmin);
    if (to !== "/notifications") navigate(to);
  };

  return (
    <AppShell title="Notifications">
      <PageHeader
        title="Notifications"
        subtitle="Leave decisions, device changes, security alerts and HR events."
        actions={
          <Button size="sm" variant="outline" className="glass" onClick={markAll}>
            <CheckCheck className="size-4" /> Mark all read
          </Button>
        }
      />

      {loading ? (
        <GlassCard className="p-10 text-center text-sm text-muted-foreground">
          <Loader2 className="mx-auto mb-2 size-5 animate-spin" /> Loading…
        </GlassCard>
      ) : rows.length === 0 ? (
        <GlassCard className="p-5"><Empty icon={Bell} text="Nothing here yet." /></GlassCard>
      ) : (
        <div className="space-y-2">
          {rows.map((n) => {
            const Icon = ICONS[n.type] ?? Bell;
            return (
              <GlassCard
                key={n.id}
                className={`flex cursor-pointer items-start gap-3.5 p-4 transition hover:ring-1 hover:ring-primary/30 ${n.read_at ? "opacity-60" : ""}`}
                onClick={() => open(n)}
              >
                <div className="glass-inset mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl">
                  <Icon className="size-4.5 text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold">{n.title}</p>
                    {!n.read_at && <Badge className="bg-primary/15 text-primary" variant="secondary">new</Badge>}
                  </div>
                  <p className="mt-0.5 text-sm text-muted-foreground">{n.body}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground/70">{new Date(n.created_at).toLocaleString()}</p>
                </div>
                {!n.read_at && (
                  <Button size="sm" variant="ghost" className="h-7 shrink-0 text-xs" onClick={(e) => { e.stopPropagation(); markOne(n.id); }}>
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
