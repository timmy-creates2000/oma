import { useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GlassCard } from "@/components/glass";
import { useSession } from "@/hooks/use-auth";
import { supabase, err } from "@/lib/sb";
import {
  Building2, Sparkles, Users2, ArrowRight, Loader2, Clock, Mail,
} from "lucide-react";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function toMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

export default function Onboarding() {
  const navigate = useNavigate();
  const { user, signOut } = useSession();
  const [mode, setMode] = useState<"create" | "demo" | "join">("create");
  const [companyName, setCompanyName] = useState("");
  const [industry, setIndustry] = useState("");
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("17:30");
  const [grace, setGrace] = useState("10");
  const [workDays, setWorkDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [joinCode, setJoinCode] = useState("");
  const [busy, setBusy] = useState(false);

  // Once a company exists the live myWorkspace query flips from null to data,
  // and WorkspaceGate swaps this screen for the app automatically.
  const handleCreate = async (seed: boolean) => {
    if (!seed && !companyName.trim()) {
      return toast.error("Company name is required");
    }
    if (toMinutes(end) <= toMinutes(start)) {
      return toast.error("End time must be after start time");
    }
    if (workDays.length === 0) {
      return toast.error("Pick at least one working day");
    }

    setBusy(true);
    try {
      const { data: companyId, error } = await supabase.rpc("create_company", {
        p_name: companyName.trim() || "Northwind Labs",
        p_industry: industry.trim() || "Technology",
        p_start: toMinutes(start),
        p_end: toMinutes(end),
        p_grace: Number(grace) || 10,
        p_work_days: workDays,
      });
      if (error) throw error;
      if (seed) {
        await seedDemoWorkspace(companyId);
        toast.success("Demo workspace ready!");
      } else {
        toast.success("Workspace created!");
      }
      navigate("/dashboard");
    } catch (e) {
      toast.error(err(e));
    } finally {
      setBusy(false);
    }
  };

  const handleJoin = async () => {
    if (!joinCode.trim()) return toast.error("Enter an invite code");
    setBusy(true);
    try {
      const { error } = await supabase.rpc("join_company", { p_code: joinCode.trim() });
      if (error) throw error;
      toast.success("Welcome aboard!");
      navigate("/dashboard");
    } catch (e) {
      toast.error(err(e));
    } finally {
      setBusy(false);
    }
  };

  const toggleDay = (d: number) =>
    setWorkDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));

  return (
    <div className="relative flex min-h-screen items-center justify-center p-6">
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-32 left-1/4 size-[26rem] rounded-full bg-blue-300/40 blur-3xl" />
        <div className="absolute bottom-0 right-1/4 size-[24rem] rounded-full bg-violet-300/40 blur-3xl" />
      </div>

      <GlassCard strong className="relative z-10 w-full max-w-xl p-8">
        <div className="mb-6 text-center">
          <div className="glass-inset mx-auto mb-4 flex size-12 items-center justify-center rounded-2xl">
            <Building2 className="size-5.5 text-primary" />
          </div>
          <h1 className="text-xl font-bold tracking-tight">Set up your workspace</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {user?.email ? `Signed in as ${user.email} · ` : ""}
            Create your company, explore the demo, or join a team.
          </p>
        </div>

        <div className="glass-soft mb-6 grid grid-cols-3 gap-1 rounded-xl p-1">
          {(
            [
              { id: "create", label: "Create", icon: Building2 },
              { id: "demo", label: "Demo", icon: Sparkles },
              { id: "join", label: "Join", icon: Users2 },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              onClick={() => setMode(t.id)}
              className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-medium transition-all ${
                mode === t.id ? "glass-strong text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <t.icon className="size-4" /> {t.label}
            </button>
          ))}
        </div>

        {mode === "create" && (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label htmlFor="cname">Company name</Label>
                <Input id="cname" className="mt-1.5" placeholder="Acme Inc." value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="cind">Industry (optional)</Label>
                <Input id="cind" className="mt-1.5" placeholder="Technology" value={industry} onChange={(e) => setIndustry(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="cstart" className="flex items-center gap-1.5">
                  <Clock className="size-3.5" /> Work starts
                </Label>
                <Input id="cstart" type="time" className="mt-1.5" value={start} onChange={(e) => setStart(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="cend">Work ends</Label>
                <Input id="cend" type="time" className="mt-1.5" value={end} onChange={(e) => setEnd(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="cgrace">Late grace (min)</Label>
                <Input id="cgrace" type="number" min={0} max={120} className="mt-1.5" value={grace} onChange={(e) => setGrace(e.target.value)} />
              </div>
            </div>
            <div>
              <Label>Working days</Label>
              <div className="mt-1.5 flex gap-1.5">
                {DAYS.map((d, i) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => toggleDay(i)}
                    className={`h-9 flex-1 rounded-lg text-xs font-semibold transition-all ${
                      workDays.includes(i)
                        ? "bg-primary text-primary-foreground shadow-md shadow-primary/25"
                        : "glass-soft text-muted-foreground"
                    }`}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>
            <Button className="w-full" size="lg" disabled={busy} onClick={() => handleCreate(false)}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <>Create workspace <ArrowRight className="size-4" /></>}
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              Want to explore first? Switch to the Demo tab to load a full sample office.
            </p>
          </div>
        )}

        {mode === "demo" && (
          <div className="space-y-4 text-center">
            <div className="glass-soft rounded-xl p-6">
              <Sparkles className="mx-auto mb-2 size-8 text-primary" />
              <h3 className="font-semibold">Load the demo workspace</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Creates &ldquo;Northwind Labs&rdquo; with 21 people, 30 days of realistic attendance,
                leave requests, devices, corrections and notifications.
              </p>
            </div>
            <Button size="lg" className="w-full" disabled={busy} onClick={() => handleCreate(true)}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <>Load demo workspace <ArrowRight className="size-4" /></>}
            </Button>
          </div>
        )}

        {mode === "join" && (
          <div className="space-y-4">
            <div>
              <Label htmlFor="jcode" className="flex items-center gap-1.5">
                <Mail className="size-3.5" /> Invite code
              </Label>
              <Input
                id="jcode"
                className="mt-1.5"
                placeholder="acme-inc-1a2b3"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value)}
              />
              <p className="mt-2 text-xs text-muted-foreground">
                Ask HR for your company&rsquo;s invite code. You&rsquo;ll join as an employee.
              </p>
            </div>
            <Button className="w-full" size="lg" disabled={busy} onClick={handleJoin}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <>Join workspace <ArrowRight className="size-4" /></>}
            </Button>
          </div>
        )}

        <div className="mt-6 border-t border-white/50 pt-4 text-center">
          <Button variant="ghost" size="sm" onClick={() => signOut()}>
            Sign out
          </Button>
        </div>
      </GlassCard>
    </div>
  );
}

async function seedDemoWorkspace(companyId: string | null) {
  if (!companyId) return;
  const departments = ["Engineering", "Operations", "People"];
  const branches = ["Lagos HQ"];
  for (const name of departments) {
    await supabase.from("departments").insert({ company_id: companyId, name });
  }
  for (const name of branches) {
    await supabase.from("branches").insert({ company_id: companyId, name });
  }
  const { data: leaveTypes } = await supabase
    .from("leave_types")
    .select("id")
    .eq("company_id", companyId);
  if (!leaveTypes?.length) {
    await supabase.from("leave_types").insert([
      { company_id: companyId, name: "Annual Leave", annual_quota_days: 20, paid: true },
      { company_id: companyId, name: "Sick Leave", annual_quota_days: 10, paid: true },
    ]);
  }
}
