"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchSearch } from "@/components/search/api";
import { type SearchResponse, type SearchType } from "@/components/search/types";
import { GlobalSearch } from "@/components/search/GlobalSearch";
import { SearchHeader } from "./_components/SearchHeader";
import { SearchControls } from "./_components/SearchControls";
import { SearchResults } from "./_components/SearchResults";
import {
  SearchIdleState,
  SearchLoadingState,
  SearchErrorState,
  SearchEmptyState,
} from "./_components/SearchStates";

export default function SearchPage() {
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [typeFilter, setTypeFilter] = useState<SearchType | "">("");

  const [data, setData] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [paletteOpen, setPaletteOpen] = useState(false);

  // Debounce the typed query.
  useEffect(() => {
    const handle = setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => clearTimeout(handle);
  }, [q]);

  // Cmd/Ctrl+K opens the command palette overlay.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const load = useCallback(async () => {
    if (debouncedQ.length === 0) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetchSearch({
        q: debouncedQ,
        type: typeFilter || undefined,
      });
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [debouncedQ, typeFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const hasResults = useMemo(() => Boolean(data && data.total > 0), [data]);

  return (
    <div>
      <SearchHeader />

      <SearchControls
        q={q}
        typeFilter={typeFilter}
        onQChange={setQ}
        onTypeChange={setTypeFilter}
      />

      <div className="mt-6">
        {debouncedQ.length === 0 ? (
          <SearchIdleState />
        ) : loading ? (
          <SearchLoadingState />
        ) : error ? (
          <SearchErrorState message={error} onRetry={() => void load()} />
        ) : !hasResults ? (
          <SearchEmptyState query={debouncedQ} />
        ) : (
          <SearchResults groups={data!.groups} />
        )}
      </div>

      <GlobalSearch open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}
