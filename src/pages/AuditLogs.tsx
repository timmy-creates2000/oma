import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/AppShell";
import { GlassCard, PageHeader, Empty } from "@/components/glass";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useQuery } from "convex/react";
import { useMemo, useState } from "react";
import { ScrollText, Search } from "lucide-react";

export default function AuditLogs() {
  const logs = useQuery(api.platform.auditLogs, { limit: 300 });
  const [q, setQ] = useState("");

  const rows = useMemo(() => {
    if (!logs) return [];
    if (!q.trim()) return logs;
    const needle = q.toLowerCase();
    return logs.filter(
      (l) =>
        l.action.toLowerCase().includes(needle) ||
        (l.detail ?? "").toLowerCase().includes(needle) ||
        l.actorEmail.toLowerCase().includes(needle),
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

      {!logs ? (
        <GlassCard className="p-10 text-center text-sm text-muted-foreground">Loading…</GlassCard>
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
                <tr key={l._id} className="border-b border-white/30 last:border-0">
                  <td className="whitespace-nowrap px-3 py-2.5 text-xs text-muted-foreground">
                    {new Date(l.at).toLocaleString()}
                  </td>
                  <td className="px-3 py-2.5 font-medium">{l.actorEmail}</td>
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
