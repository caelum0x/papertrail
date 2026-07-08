"use client";

import { useCallback, useEffect, useState } from "react";
import { getJson, type Envelope } from "@/components/admin-audit/apiClient";
import type { ToolCall } from "./types";

const PAGE_SIZE = 20;

interface ToolCallsState {
  calls: ToolCall[];
  page: number;
  totalPages: number;
  loading: boolean;
  error: string | null;
  load: (page: number) => void;
}

// Paginated tool-call history from the existing GET /api/tools/calls, newest
// first. Shared by the call-history page.
export function useToolCalls(): ToolCallsState {
  const [calls, setCalls] = useState<ToolCall[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (targetPage: number) => {
    setLoading(true);
    setError(null);
    const res: Envelope<ToolCall[]> = await getJson<ToolCall[]>(
      `/api/tools/calls?page=${targetPage}&limit=${PAGE_SIZE}`
    );
    if (!res.success || !res.data) {
      setError(res.error ?? "Failed to load call history.");
      setLoading(false);
      return;
    }
    setCalls(res.data);
    setTotal(res.meta?.total ?? res.data.length);
    setPage(targetPage);
    setLoading(false);
  }, []);

  useEffect(() => {
    load(1);
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return { calls, page, totalPages, loading, error, load };
}
