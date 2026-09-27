import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/AppShell";
import { GlassCard, PageHeader, Empty } from "@/components/glass";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useQuery, useMutation } from "convex/react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { Users, Search, Plus, RefreshCw, Building2, MapPin } from "lucide-react";

const ROLE_META: Record<string, { label: string; cls: string }> = {
  company_admin: { label: "Admin", cls: "bg-violet-500/15 text-violet-700" },
  hr_admin: { label: "HR", cls: "bg-sky-500/15 text-sky-700" },
  manager: { label: "Manager", cls: "bg-amber-500/15 text-amber-700" },
  employee: { label: "Employee", cls: "bg-slate-500/15 text-slate-600" },
};

export default function Employees() {
  const navigate = useNavigate();
  const employees = useQuery(api.employees.list, {});
  const departments = useQuery(api.employees.listDepartments, {});
  const branches = useQuery(api.employees.listBranches, {});
  const addEmployee = useMutation(api.employees.add);
  const addDept = useMutation(api.employees.addDepartment);
  const addBranch = useMutation(api.employees.addBranch);

  const [q, setQ] = useState("");
  const [deptFilter, setDeptFilter] = useState("all");

  // add employee dialog
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [role, setRole] = useState("employee");
  const [position, setPosition] = useState("");
  const [deptId, setDeptId] = useState("");
  const [branchId, setBranchId] = useState("");

  // new department / branch
  const [deptOpen, setDeptOpen] = useState(false);
  const [deptName, setDeptName] = useState("");
  const [branchOpen, setBranchOpen] = useState(false);
  const [branchName, setBranchName] = useState("");
  const [branchAddr, setBranchAddr] = useState("");

  const rows = useMemo(() => {
    if (!employees) return [];
    let r = employees;
    if (q.trim()) {
      const needle = q.toLowerCase();
      r = r.filter(
        (e) =>
          e.name.toLowerCase().includes(needle) ||
          e.email.toLowerCase().includes(needle) ||
          e.employeeCode.toLowerCase().includes(needle),
      );
    }
    if (deptFilter !== "all") r = r.filter((e) => e.department === deptFilter);
    return r;
  }, [employees, q, deptFilter]);

  const handleAdd = async () => {
    try {
      await addEmployee({
        name,
        email,
        employeeCode: code,
        role: role as any,
        position: position || undefined,
        departmentId: (deptId || undefined) as any,
        branchId: (branchId || undefined) as any,
      });
      toast.success("Employee seat created", {
        description: "They can join with code " + code + " after signing up.",
      });
      setOpen(false);
      setName(""); setEmail(""); setCode(""); setPosition("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add employee");
    }
  };

  return (
    <AppShell title="Employees">
      <PageHeader
        title="Employees"
        subtitle={`${employees?.length ?? "…"} people across ${departments?.length ?? "…"} departments`}
        actions={
          <>
            <Button variant="outline" className="glass" size="sm" onClick={() => setDeptOpen(true)}>
              <Building2 className="size-4" /> Department
            </Button>
            <Button variant="outline" className="glass" size="sm" onClick={() => setBranchOpen(true)}>
              <MapPin className="size-4" /> Branch
            </Button>
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button size="sm"><Plus className="size-4" /> Add employee</Button>
              </DialogTrigger>
              <DialogContent className="glass-strong">
                <DialogHeader>
                  <DialogTitle>Add employee</DialogTitle>
                  <DialogDescription>
                    Creates a seat. The person joins by signing up and entering the company code with their seat code.
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label>Name</Label>
                    <Input className="mt-1.5" value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe" />
                  </div>
                  <div>
                    <Label>Email</Label>
                    <Input className="mt-1.5" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jane@company.com" />
                  </div>
                  <div>
                    <Label>Employee code</Label>
                    <Input className="mt-1.5" value={code} onChange={(e) => setCode(e.target.value)} placeholder="EMP-023" />
                  </div>
                  <div>
                    <Label>Role</Label>
                    <Select value={role} onValueChange={setRole}>
                      <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="employee">Employee</SelectItem>
                        <SelectItem value="manager">Manager</SelectItem>
                        <SelectItem value="hr_admin">HR admin</SelectItem>
                        <SelectItem value="company_admin">Company admin</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Position</Label>
                    <Input className="mt-1.5" value={position} onChange={(e) => setPosition(e.target.value)} placeholder="Designer" />
                  </div>
                  <div>
                    <Label>Department</Label>
                    <Select value={deptId} onValueChange={setDeptId}>
                      <SelectTrigger className="mt-1.5"><SelectValue placeholder="None" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        {(departments ?? []).map((d) => (
                          <SelectItem key={d._id} value={d._id}>{d.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="sm:col-span-2">
                    <Label>Branch</Label>
                    <Select value={branchId} onValueChange={setBranchId}>
                      <SelectTrigger className="mt-1.5"><SelectValue placeholder="None" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        {(branches ?? []).map((b) => (
                          <SelectItem key={b._id} value={b._id}>{b.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" className="glass" onClick={() => setOpen(false)}>Cancel</Button>
                  <Button onClick={handleAdd} disabled={!name || !email || !code}>Add employee</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </>
        }
      />

      <GlassCard className="mb-4 flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search name, email or code…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Select value={deptFilter} onValueChange={setDeptFilter}>
          <SelectTrigger className="sm:w-52"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All departments</SelectItem>
            {(departments ?? []).map((d) => (
              <SelectItem key={d._id} value={d.name}>{d.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </GlassCard>

      {!employees ? (
        <GlassCard className="p-10 text-center text-sm text-muted-foreground">
          <RefreshCw className="mx-auto mb-2 size-5 animate-spin" /> Loading…
        </GlassCard>
      ) : rows.length === 0 ? (
        <GlassCard className="p-5"><Empty icon={Users} text="No employees found." /></GlassCard>
      ) : (
        <GlassCard className="overflow-x-auto p-2">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/50 text-left text-xs text-muted-foreground">
                <th className="px-3 py-3 font-medium">Employee</th>
                <th className="px-3 py-3 font-medium">Code</th>
                <th className="px-3 py-3 font-medium">Role</th>
                <th className="px-3 py-3 font-medium">Department</th>
                <th className="px-3 py-3 font-medium">Branch</th>
                <th className="px-3 py-3 font-medium">Position</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => {
                const meta = ROLE_META[e.role];
                return (
                  <tr
                    key={e._id}
                    className="cursor-pointer border-b border-white/30 transition-colors last:border-0 hover:bg-white/40"
                    onClick={() => navigate(`/employees/${e._id}`)}
                  >
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-3">
                        <div className="glass-inset flex size-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-primary">
                          {e.name.slice(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <p className="font-medium">{e.name}</p>
                          <p className="text-[11px] text-muted-foreground">{e.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3 font-mono text-xs">{e.employeeCode}</td>
                    <td className="px-3 py-3">
                      <Badge variant="secondary" className={meta?.cls ?? ""}>{meta?.label ?? e.role}</Badge>
                    </td>
                    <td className="px-3 py-3 text-muted-foreground">{e.department ?? "—"}</td>
                    <td className="px-3 py-3 text-muted-foreground">{e.branch ?? "—"}</td>
                    <td className="px-3 py-3 text-muted-foreground">{e.position ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </GlassCard>
      )}

      {/* new department */}
      <Dialog open={deptOpen} onOpenChange={setDeptOpen}>
        <DialogContent className="glass-strong max-w-sm">
          <DialogHeader>
            <DialogTitle>New department</DialogTitle>
          </DialogHeader>
          <Input placeholder="Engineering" value={deptName} onChange={(e) => setDeptName(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" className="glass" onClick={() => setDeptOpen(false)}>Cancel</Button>
            <Button
              onClick={async () => {
                try {
                  await addDept({ name: deptName });
                  toast.success("Department added");
                  setDeptOpen(false);
                  setDeptName("");
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Failed");
                }
              }}
              disabled={!deptName.trim()}
            >
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* new branch */}
      <Dialog open={branchOpen} onOpenChange={setBranchOpen}>
        <DialogContent className="glass-strong max-w-sm">
          <DialogHeader>
            <DialogTitle>New branch</DialogTitle>
            <DialogDescription>Optionally set GPS coordinates to enable geofenced scanning later.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input placeholder="Branch name" value={branchName} onChange={(e) => setBranchName(e.target.value)} />
            <Input placeholder="Address (optional)" value={branchAddr} onChange={(e) => setBranchAddr(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" className="glass" onClick={() => setBranchOpen(false)}>Cancel</Button>
            <Button
              onClick={async () => {
                try {
                  await addBranch({ name: branchName, address: branchAddr || undefined });
                  toast.success("Branch added");
                  setBranchOpen(false);
                  setBranchName(""); setBranchAddr("");
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Failed");
                }
              }}
              disabled={!branchName.trim()}
            >
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
