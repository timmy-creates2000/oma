import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/AppShell";
import { GlassCard, PageHeader } from "@/components/glass";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useQuery } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";
import { FileDown, FileSpreadsheet, FileText, FileText as FileIcon } from "lucide-react";

type Row = {
  employeeId: string;
  name: string;
  code: string;
  department: string;
  presentDays: number;
  lateDays: number;
  halfDays: number;
  absentDays: number;
  leaveDays: number;
  workedHours: number;
  overtimeHours: number;
  lateMinutes: number;
};

function shiftDays(days: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export default function Reports() {
  const [from, setFrom] = useState(shiftDays(-29));
  const [to, setTo] = useState(shiftDays(0));
  const [dept, setDept] = useState("all");
  const [q, setQ] = useState("");
  const [sortKey, setSortKey] = useState("name");

  const departments = useQuery(api.employees.listDepartments, {});
  const data = useQuery(api.analytics.range, {
    from,
    to,
    departmentId: dept !== "all" ? (dept as any) : undefined,
  });

  const rows: Row[] = useMemoRows(data, q, sortKey);

  const exportCsv = () => {
    const header = ["Employee", "Code", "Department", "Present", "Late", "Half-day", "Absent", "Leave", "Hours", "Overtime h", "Late min"];
    const lines = rows.map((r) =>
      [r.name, r.code, r.department, r.presentDays, r.lateDays, r.halfDays, Math.round(r.absentDays), r.leaveDays, r.workedHours, r.overtimeHours, r.lateMinutes].join(","),
    );
    download([header.join(","), ...lines].join("\n"), `officeflow-attendance-${from}_${to}.csv`, "text/csv");
    toast.success("CSV exported");
  };

  const exportXls = () => {
    const header = "<tr><th>Employee</th><th>Code</th><th>Department</th><th>Present</th><th>Late</th><th>Half-day</th><th>Absent</th><th>Leave</th><th>Hours</th><th>Overtime h</th><th>Late min</th></tr>";
    const body = rows
      .map((r) =>
        `<tr><td>${r.name}</td><td>${r.code}</td><td>${r.department}</td><td>${r.presentDays}</td><td>${r.lateDays}</td><td>${r.halfDays}</td><td>${Math.round(r.absentDays)}</td><td>${r.leaveDays}</td><td>${r.workedHours}</td><td>${r.overtimeHours}</td><td>${r.lateMinutes}</td></tr>`,
      )
      .join("");
    const html = `<html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8" /></head><body><table border="1">${header}${body}</table></body></html>`;
    download(html, `officeflow-attendance-${from}_${to}.xls`, "application/vnd.ms-excel");
    toast.success("Excel exported");
  };

  const exportPdf = () => {
    const header = "<tr><th>Employee</th><th>Code</th><th>Dept</th><th>Present</th><th>Late</th><th>Hours</th><th>OT</th></tr>";
    const body = rows
      .map((r) =>
        `<tr><td>${r.name}</td><td>${r.code}</td><td>${r.department}</td><td>${r.presentDays}</td><td>${r.lateDays}</td><td>${r.workedHours}</td><td>${r.overtimeHours}</td></tr>`,
      )
      .join("");
    const win = window.open("", "_blank");
    if (!win) {
      toast.error("Allow popups to export PDF");
      return;
    }
    win.document.write(`<html><head><title>OfficeFlow report ${from} → ${to}</title>
      <style>
        body { font-family: system-ui, sans-serif; padding: 32px; color: #1e293b; }
        h1 { font-size: 20px; margin: 0 0 4px; }
        p { color: #64748b; font-size: 12px; margin: 0 0 20px; }
        table { width: 100%; border-collapse: collapse; font-size: 12px; }
        th { text-align: left; background: #eef2ff; padding: 8px; border-bottom: 2px solid #c7d2fe; }
        td { padding: 7px 8px; border-bottom: 1px solid #e2e8f0; }
      </style></head><body>
      <h1>OfficeFlow — Attendance report</h1>
      <p>${from} → ${to} · generated ${new Date().toLocaleString()}</p>
      <table>${header}${body}</table>
      <script>window.onload = () => window.print();</script>
      </body></html>`);
    win.document.close();
    toast.success("Print dialog opened — save as PDF");
  };

  return (
    <AppShell title="Reports">
      <PageHeader
        title="Reports"
        subtitle="Payroll-ready attendance summaries with export."
        actions={
          <>
            <Button size="sm" variant="outline" className="glass" onClick={exportCsv}>
              <FileText className="size-4" /> CSV
            </Button>
            <Button size="sm" variant="outline" className="glass" onClick={exportXls}>
              <FileSpreadsheet className="size-4" /> Excel
            </Button>
            <Button size="sm" onClick={exportPdf}>
              <FileDown className="size-4" /> PDF
            </Button>
          </>
        }
      />

      <GlassCard className="mb-4 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        <Select value={dept} onValueChange={setDept}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All departments</SelectItem>
            {(departments ?? []).map((d) => <SelectItem key={d._id} value={d._id}>{d.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input placeholder="Search employee…" value={q} onChange={(e) => setQ(e.target.value)} />
      </GlassCard>

      {!data ? (
        <GlassCard className="p-10 text-center text-sm text-muted-foreground">Loading…</GlassCard>
      ) : (
        <GlassCard className="overflow-x-auto p-2">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/50 text-left text-xs text-muted-foreground">
                <th className="px-3 py-3 font-medium">Employee</th>
                <th className="px-3 py-3 font-medium">Dept</th>
                <th className="px-3 py-3 font-medium">Present</th>
                <th className="px-3 py-3 font-medium">Late</th>
                <th className="px-3 py-3 font-medium">Half</th>
                <th className="px-3 py-3 font-medium">Absent</th>
                <th className="px-3 py-3 font-medium">Leave</th>
                <th className="px-3 py-3 font-medium">Hours</th>
                <th className="px-3 py-3 font-medium">OT h</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.employeeId} className="border-b border-white/30 last:border-0">
                  <td className="px-3 py-2.5">
                    <p className="font-medium">{r.name}</p>
                    <p className="text-[11px] text-muted-foreground">{r.code}</p>
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground">{r.department}</td>
                  <td className="px-3 py-2.5">{r.presentDays}</td>
                  <td className="px-3 py-2.5">{r.lateDays}</td>
                  <td className="px-3 py-2.5">{r.halfDays}</td>
                  <td className="px-3 py-2.5">{Math.round(r.absentDays)}</td>
                  <td className="px-3 py-2.5">{r.leaveDays}</td>
                  <td className="px-3 py-2.5 font-medium">{r.workedHours}</td>
                  <td className="px-3 py-2.5">{r.overtimeHours || "—"}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={9} className="px-3 py-10 text-center text-muted-foreground">No data in range.</td></tr>
              )}
            </tbody>
          </table>
        </GlassCard>
      )}

      <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
        <FileIcon className="size-3.5" /> Exports reflect the current filters. Absent days are estimated against expected work days minus recorded sessions.
      </p>
    </AppShell>
  );
}

function useMemoRows(data: any, q: string, sortKey: string): Row[] {
  if (!data?.perEmployee) return [];
  let rows: Row[] = data.perEmployee;
  if (q.trim()) rows = rows.filter((r: Row) => r.name.toLowerCase().includes(q.toLowerCase()));
  rows = [...rows].sort((a, b) => {
    if (sortKey === "name") return a.name.localeCompare(b.name);
    return (b as any)[sortKey] - (a as any)[sortKey];
  });
  return rows;
}

function download(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
