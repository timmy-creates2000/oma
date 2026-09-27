import { AppShell } from "@/components/AppShell";
import { GlassCard, PageHeader, Empty } from "@/components/glass";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useEffect, useMemo, useState } from "react";
import { ScrollText, Search, Loader2 } from "lucide-react";
import { supabase, type AuditLog } from "@/lib/sb";
import { useWorkspace } from "@/hooks/use-workspace";

export default function AuditLogs() {
  const { ws } = useWorkspace();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  useEffect(() => {
    if (!ws) return;
    (async () => {
      const { data } = await supabase
        .from("audit_logs")
        .select("*")
        .eq("company_id", ws.employee.company_id)
        .order("at", { ascending: false })
        .limit(300);
      setLogs((data ?? []) as unknown as AuditLog[]);
      setLoading(false);
    })();
  }, [ws]);

  const rows = useMemo(() => {
    if (!q.trim()) return logs;
    const n = q.toLowerCase();
    return logs.filter(
      (l) =>
        l.action.toLowerCase().includes(n) ||
        (l.detail ?? "").toLowerCase().includes(n) ||
        l.actor_email.toLowerCase().includes(n),
    );
  }, [logs, q]);

  return (
    <AppShell title="Audit logs">
      <PageHeader
        title="Audit logs"
        subtitle="Immutable trail of sensitive actions — logins, approvals, device changes and more."
      />

      <GlassCard className="mb-4 p-4">
        <div className="relative">
          <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Filter by action, actor or detail…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </GlassCard>

      {loading ? (
        <GlassCard className="p-10 text-center text-sm text-muted-foreground">
          <Loader2 className="mx-auto mb-2 size-5 animate-spin" /> Loading…
        </GlassCard>
      ) : rows.length === 0 ? (
        <GlassCard className="p-5"><Empty icon={ScrollText} text="No log entries match." /></GlassCard>
      ) : (
        <GlassCard className="overflow-x-auto p-2">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/50 text-left text-xs text-muted-foreground">
                <th className="px-3 py-3 font-medium">When</th>
                <th className="px-3 py-3 font-medium">Actor</th>
                <th className="px-3 py-3 font-medium">Action</th>
                <th className="px-3 py-3 font-medium">Detail</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.id} className="border-b border-white/30 last:border-0">
                  <td className="whitespace-nowrap px-3 py-2.5 text-xs text-muted-foreground">
                    {new Date(l.at).toLocaleString()}
                  </td>
                  <td className="px-3 py-2.5 font-medium">{l.actor_email}</td>
                  <td className="px-3 py-2.5">
                    <Badge variant="secondary" className="bg-primary/10 font-mono text-[10px] text-primary">
                      {l.action}
                    </Badge>
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground">{l.detail ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </GlassCard>
      )}
    </AppShell>
  );
}
