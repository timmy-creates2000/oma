import { useState, useCallback } from "react";
import { supabase, err } from "@/lib/sb";

/** Minimal mutation wrapper around supabase.rpc for ergonomic page code. */
export function useRpc<T = unknown>(fn: string) {
  const [loading, setLoading] = useState(false);

  const mutate = useCallback(
    async (args: Record<string, unknown> = {}): Promise<T> => {
      setLoading(true);
      try {
        const { data, error } = await supabase.rpc(fn, args);
        if (error) throw error;
        return data as T;
      } finally {
        setLoading(false);
      }
    },
    [fn],
  );

  return { mutate, loading };
}
