import { useEffect, useState } from "react";
import { supabase, type Employee, type Company, type CompanySettings } from "@/lib/sb";
import { useSupabaseAuth } from "./use-supabase-auth";

export type Workspace = {
  employee: Employee;
  company: Company;
  settings: CompanySettings;
};

export function useWorkspace(): {
  ws: Workspace | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
} {
  const { user, loading: authLoading } = useSupabaseAuth();
  const [ws, setWs] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (authLoading) return;
      if (!user) {
        setWs(null);
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      // limit(1) instead of maybeSingle(): a duplicate row must never bounce a signed-in
      // user back to onboarding. A network/DB error is shown as an error, not as "no company".
      let rows: unknown[] | null = null;
      let qErr: { message: string } | null = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        const res = await supabase
          .from("employees")
          .select("*, departments(name), branches(name)")
          .eq("user_id", user.id)
          .eq("active", true)
          .is("deleted_at", null)
          .order("joined_at", { ascending: false })
          .limit(1);
        rows = res.data;
        qErr = res.error;
        if (!qErr) break;
        await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
        if (cancelled) return;
      }

      if (cancelled) return;
      if (qErr) {
        setWs(null);
        setError(qErr.message);
        setLoading(false);
        return;
      }
      const emp = rows?.[0];
      if (!emp) {
        setWs(null);
        setLoading(false);
        return;
      }
      const employee = emp as unknown as Employee;

      const [{ data: co }, { data: st }] = await Promise.all([
        supabase.from("companies").select("*").eq("id", employee.company_id).maybeSingle(),
        supabase.from("company_settings").select("*").eq("company_id", employee.company_id).maybeSingle(),
      ]);
      if (cancelled) return;
      setWs({
        employee,
        company: (co ?? null) as unknown as Company,
        settings: (st ?? {
          company_id: employee.company_id,
          qr_rotation_seconds: 10,
          require_geo: false,
          auto_clock_out_hours: 14,
          retention_days: 730,
        }) as unknown as CompanySettings,
      });
      setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [user, authLoading, tick]);

  return { ws, loading, error, refresh: () => setTick((t) => t + 1) };
}
