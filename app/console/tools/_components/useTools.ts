"use client";

import { useCallback, useEffect, useState } from "react";
import { getJson } from "@/components/admin-audit/apiClient";
import type { Tool } from "./types";

interface ToolsState {
  tools: Tool[];
  loading: boolean;
  error: string | null;
  reload: () => void;
}

// Loads the org's callable tool catalog from the existing GET /api/tools.
// Shared by the tools home and the overview sub-page.
export function useTools(): ToolsState {
  const [tools, setTools] = useState<Tool[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await getJson<Tool[]>("/api/tools");
    if (!res.success || !res.data) {
      setError(res.error ?? "Failed to load tools.");
      setLoading(false);
      return;
    }
    setTools(res.data);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { tools, loading, error, reload: load };
}
