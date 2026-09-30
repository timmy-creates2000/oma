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
  refresh: () => void;
} {
  const { user, loading: authLoading } = useSupabaseAuth();
  const [ws, setWs] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(true);
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
      const { data: emp, error } = await supabase
        .from("employees")
        .select("*, departments(name), branches(name)")
        .eq("user_id", user.id)
        .eq("active", true)
        .maybeSingle();

      if (cancelled) return;
      if (error || !emp) {
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

  return { ws, loading, refresh: () => setTick((t) => t + 1) };
}
