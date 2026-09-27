import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/AppShell";
import { GlassCard, PageHeader, Empty } from "@/components/glass";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useQuery } from "convex/react";
import { useState } from "react";
import { ClipboardList, AlertTriangle } from "lucide-react";

function fmtTime(ts: number) {
  return new Date(ts).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
}

const STATUS_META: Record<string, string> = {
  present: "bg-emerald-500/15 text-emerald-700",
  late: "bg-amber-500/15 text-amber-700",
  half_day: "bg-orange-500/15 text-orange-700",
  ongoing: "bg-sky-500/15 text-sky-700",
  holiday: "bg-violet-500/15 text-violet-700",
  weekend: "bg-slate-500/15 text-slate-600",
  on_leave: "bg-sky-500/15 text-sky-700",
  absent: "bg-rose-500/15 text-rose-700",
};

export default function AttendanceAdmin() {
  const [day, setDay] = useState(new Date().toISOString().slice(0, 10));
  const [status, setStatus] = useState("all");
  const sessions = useQuery(api.attendance.adminListSessions, { day, status: status === "all" ? undefined : status });

  return (
    <AppShell title="Attendance">
      <PageHeader
        title="Attendance records"
        subtitle="Every clock-in/out with automatic status calculation."
      />

      <GlassCard className="mb-4 flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
        <Input type="date" className="sm:w-44" value={day} onChange={(e) => setDay(e.target.value)} />
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="sm:w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {Object.entries(STATUS_META).map(([k]) => (
              <SelectItem key={k} value={k}>{k.replace("_", " ")}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </GlassCard>

      {!sessions ? (
        <GlassCard className="p-10 text-center text-sm text-muted-foreground">Loading…</GlassCard>
      ) : sessions.length === 0 ? (
        <GlassCard className="p-5">
          <Empty icon={ClipboardList} text="No sessions for this day / filter." />
        </GlassCard>
      ) : (
        <>
          {sessions.some(({ session }) => !session.clockOutAt && session.status !== "on_leave") && (
            <GlassCard className="mb-4 flex items-start gap-2.5 border-amber-300/60 p-4 text-sm">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
              <span>
                Rows marked <b>working…</b> have an open session. The auto clock-out sweep closes sessions
                older than the configured limit and marks them half-day.
              </span>
            </GlassCard>
          )}
          <GlassCard className="overflow-x-auto p-2">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/50 text-left text-xs text-muted-foreground">
                  <th className="px-3 py-3 font-medium">Employee</th>
                  <th className="px-3 py-3 font-medium">In</th>
                  <th className="px-3 py-3 font-medium">Out</th>
                  <th className="px-3 py-3 font-medium">Worked</th>
                  <th className="px-3 py-3 font-medium">Late</th>
                  <th className="px-3 py-3 font-medium">OT</th>
                  <th className="px-3 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map(({ session, employee }) => (
                  <tr key={session._id} className="border-b border-white/30 last:border-0">
                    <td className="px-3 py-3">
                      <p className="font-medium">{employee?.name ?? "Unknown"}</p>
                      <p className="text-[11px] text-muted-foreground">{employee?.employeeCode}</p>
                    </td>
                    <td className="px-3 py-3 tabular-nums">{fmtTime(session.clockInAt)}</td>
                    <td className="px-3 py-3 tabular-nums">
                      {session.clockOutAt ? fmtTime(session.clockOutAt) : <span className="text-sky-600">working…</span>}
                    </td>
                    <td className="px-3 py-3">{session.workedMinutes != null ? `${(session.workedMinutes / 60).toFixed(1)}h` : "—"}</td>
                    <td className="px-3 py-3">
                      {session.lateMinutes > 0 ? <span className="text-amber-700">+{session.lateMinutes}m</span> : "—"}
                    </td>
                    <td className="px-3 py-3">
                      {session.overtimeMinutes > 0 ? <span className="text-emerald-700">+{session.overtimeMinutes}m</span> : "—"}
                    </td>
                    <td className="px-3 py-3">
                      <Badge variant="secondary" className={STATUS_META[session.status] ?? ""}>
                        {session.status.replace("_", " ")}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </GlassCard>
        </>
      )}
    </AppShell>
  );
}
