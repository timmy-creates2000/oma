import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/AppShell";
import { GlassCard, PageHeader, Empty } from "@/components/glass";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useQuery } from "convex/react";
import { useMemo, useState } from "react";
import { Radio, Search, RefreshCw } from "lucide-react";

function fmtTime(ts: number) {
  return new Date(ts).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
}

const STATUS_META: Record<string, { label: string; cls: string }> = {
  present: { label: "Present", cls: "bg-emerald-500/15 text-emerald-700" },
  late: { label: "Late", cls: "bg-amber-500/15 text-amber-700" },
  half_day: { label: "Half day", cls: "bg-orange-500/15 text-orange-700" },
  ongoing: { label: "Working", cls: "bg-sky-500/15 text-sky-700" },
  holiday: { label: "Holiday", cls: "bg-violet-500/15 text-violet-700" },
  weekend: { label: "Weekend", cls: "bg-slate-500/15 text-slate-600" },
  on_leave: { label: "On leave", cls: "bg-sky-500/15 text-sky-700" },
  absent: { label: "Absent", cls: "bg-rose-500/15 text-rose-700" },
};

export default function LiveAttendance() {
  const live = useQuery(api.attendance.liveAttendance, {});
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");

  const rows = useMemo(() => {
    if (!live) return [];
    let r = live;
    if (q.trim()) {
      const needle = q.toLowerCase();
      r = r.filter(
        (x) =>
          x.employee.name.toLowerCase().includes(needle) ||
          x.employee.employeeCode.toLowerCase().includes(needle),
      );
    }
    if (filter === "in") r = r.filter((x) => x.session && !x.session.clockOutAt && x.session.status !== "on_leave");
    if (filter === "out") r = r.filter((x) => x.session?.clockOutAt);
    if (filter === "none") r = r.filter((x) => !x.session || x.session.status === "on_leave");
    if (filter === "late") r = r.filter((x) => x.session?.status === "late");
    return r;
  }, [live, q, filter]);

  return (
    <AppShell title="Live attendance">
      <PageHeader
        title="Live attendance"
        subtitle="Real-time status board — updates automatically as scans happen."
        actions={
          <Badge variant="outline" className="glass gap-1.5 rounded-full px-3 py-1 text-xs">
            <span className="relative flex size-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            live
          </Badge>
        }
      />

      <GlassCard className="mb-4 flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search name or code…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="sm:w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Everyone</SelectItem>
            <SelectItem value="in">Currently in office</SelectItem>
            <SelectItem value="out">Clocked out</SelectItem>
            <SelectItem value="none">Not arrived / leave</SelectItem>
            <SelectItem value="late">Late today</SelectItem>
          </SelectContent>
        </Select>
      </GlassCard>

      {!live ? (
        <GlassCard className="p-10 text-center text-sm text-muted-foreground">
          <RefreshCw className="mx-auto mb-2 size-5 animate-spin" /> Loading…
        </GlassCard>
      ) : rows.length === 0 ? (
        <GlassCard className="p-5"><Empty icon={Radio} text="No employees match this filter." /></GlassCard>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map(({ employee, session }) => {
            const meta = session ? STATUS_META[session.status] : STATUS_META.absent;
            const ongoing = session && !session.clockOutAt && session.status !== "on_leave";
            return (
              <GlassCard key={employee._id} className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{employee.name}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {employee.employeeCode}{employee.position ? ` · ${employee.position}` : ""}
                    </p>
                  </div>
                  <Badge variant="secondary" className={meta?.cls ?? ""}>{meta?.label ?? session?.status}</Badge>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <div className="glass-soft rounded-lg px-2.5 py-1.5">
                    <span className="text-muted-foreground">In:</span>{" "}
                    <span className="font-semibold tabular-nums">{session ? fmtTime(session.clockInAt) : "—"}</span>
                  </div>
                  <div className="glass-soft rounded-lg px-2.5 py-1.5">
                    <span className="text-muted-foreground">Out:</span>{" "}
                    <span className="font-semibold tabular-nums">{session?.clockOutAt ? fmtTime(session.clockOutAt) : ongoing ? "…" : "—"}</span>
                  </div>
                </div>
              </GlassCard>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}
