"use client";

import { useCallback, useEffect, useState } from "react";
import { getJson } from "@/components/billing/apiClient";
import type { TierResponse } from "./types";

interface TierState {
  data: TierResponse | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

// Loads the org's current tier + entitlements + catalog from GET /api/billing/tier.
// Uses the shared billing apiClient so the active org id is sent via x-org-id and
// the { success, data, error } envelope is unwrapped consistently.
export function useTier(): TierState {
  const [data, setData] = useState<TierResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await getJson<TierResponse>("/api/billing/tier");
    setLoading(false);
    if (!res.success || !res.data) {
      setError(res.error ?? "Failed to load tier entitlements.");
      return;
    }
    setData(res.data);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { data, loading, error, reload: load };
}
