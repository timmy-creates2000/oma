import { AppShell } from "@/components/AppShell";
import { GlassCard, PageHeader } from "@/components/glass";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { FileDown, FileSpreadsheet, FileText } from "lucide-react";
import { supabase } from "@/lib/sb";
import { useWorkspace } from "@/hooks/use-workspace";

type Row = {
  employee_id: string;
  name: string;
  code: string;
  department: string;
  present_days: number;
  late_days: number;
  half_days: number;
  absent_days: number;
  leave_days: number;
  worked_hours: number;
  overtime_hours: number;
  late_minutes: number;
};

function shiftDays(days: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export default function Reports() {
  const { ws } = useWorkspace();
  const [from, setFrom] = useState(shiftDays(-29));
  const [to, setTo] = useState(shiftDays(0));
  const [dept, setDept] = useState("all");
  const [q, setQ] = useState("");
  const [departments, setDepartments] = useState<Array<{ id: string; name: string }>>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!ws) return;
    supabase.from("departments").select("id, name").eq("company_id", ws.employee.company_id).order("name")
      .then(({ data }) => setDepartments((data ?? []) as Array<{ id: string; name: string }>));
  }, [ws]);

  useEffect(() => {
    if (!ws || !from || !to) return;
    setLoading(true);
    (async () => {
      const { data: v, error } = await supabase.rpc("analytics_range", {
        p_from: from, p_to: to, p_department: dept === "all" ? null : dept,
      });
      if (!error && v) {
        const d = v as unknown as { perEmployee: Row[] };
        setRows(d.perEmployee ?? []);
      }
      setLoading(false);
    })();
  }, [ws, from, to, dept]);

  const shown = rows
    .filter((r) => !q.trim() || r.name.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));

  const exportCsv = () => {
    const header = ["Employee", "Code", "Department", "Present", "Late", "Half-day", "Absent", "Leave", "Hours", "Overtime h", "Late min"];
    const lines = shown.map((r) =>
      [r.name, r.code, r.department, r.present_days, r.late_days, r.half_days, Math.round(r.absent_days), r.leave_days, r.worked_hours, r.overtime_hours, r.late_minutes].join(","),
    );
    download([header.join(","), ...lines].join("\n"), `officeflow-attendance-${from}_${to}.csv`, "text/csv");
    toast.success("CSV exported");
  };

  const exportXls = () => {
    const header = "<tr><th>Employee</th><th>Code</th><th>Department</th><th>Present</th><th>Late</th><th>Half-day</th><th>Absent</th><th>Leave</th><th>Hours</th><th>Overtime h</th><th>Late min</th></tr>";
    const body = shown
      .map((r) => `<tr><td>${r.name}</td><td>${r.code}</td><td>${r.department}</td><td>${r.present_days}</td><td>${r.late_days}</td><td>${r.half_days}</td><td>${Math.round(r.absent_days)}</td><td>${r.leave_days}</td><td>${r.worked_hours}</td><td>${r.overtime_hours}</td><td>${r.late_minutes}</td></tr>`)
      .join("");
    const html = `<html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8" /></head><body><table border="1">${header}${body}</table></body></html>`;
    download(html, `officeflow-attendance-${from}_${to}.xls`, "application/vnd.ms-excel");
    toast.success("Excel exported");
  };

  const exportPdf = () => {
    const header = "<tr><th>Employee</th><th>Code</th><th>Dept</th><th>Present</th><th>Late</th><th>Hours</th><th>OT</th></tr>";
    const body = shown
      .map((r) => `<tr><td>${r.name}</td><td>${r.code}</td><td>${r.department}</td><td>${r.present_days}</td><td>${r.late_days}</td><td>${r.worked_hours}</td><td>${r.overtime_hours}</td></tr>`)
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
            {departments.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input placeholder="Search employee…" value={q} onChange={(e) => setQ(e.target.value)} />
      </GlassCard>

      {loading ? (
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
              {shown.map((r) => (
                <tr key={r.employee_id} className="border-b border-white/30 last:border-0">
                  <td className="px-3 py-2.5">
                    <p className="font-medium">{r.name}</p>
                    <p className="text-[11px] text-muted-foreground">{r.code}</p>
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground">{r.department}</td>
                  <td className="px-3 py-2.5">{r.present_days}</td>
                  <td className="px-3 py-2.5">{r.late_days}</td>
                  <td className="px-3 py-2.5">{r.half_days}</td>
                  <td className="px-3 py-2.5">{Math.round(r.absent_days)}</td>
                  <td className="px-3 py-2.5">{r.leave_days}</td>
                  <td className="px-3 py-2.5 font-medium">{r.worked_hours}</td>
                  <td className="px-3 py-2.5">{r.overtime_hours || "—"}</td>
                </tr>
              ))}
              {shown.length === 0 && (
                <tr><td colSpan={9} className="px-3 py-10 text-center text-muted-foreground">No data in range.</td></tr>
              )}
            </tbody>
          </table>
        </GlassCard>
      )}
    </AppShell>
  );
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
