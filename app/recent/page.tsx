"use client";

import { useEffect, useMemo, useState } from "react";
import { RecentHeader } from "./_components/RecentHeader";
import { RecentFilters } from "./_components/RecentFilters";
import { RecentRow } from "./_components/RecentRow";
import type { RecentItem } from "./_components/recentShared";

export default function RecentPage() {
  const [items, setItems] = useState<RecentItem[] | null>(null);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");

  useEffect(() => {
    let active = true;
    fetch("/api/verifications")
      .then(async (res) => {
        if (!active) return;
        if (!res.ok) return setError(true);
        const json = await res.json();
        setItems(json.items ?? []);
      })
      .catch(() => active && setError(true));
    return () => {
      active = false;
    };
  }, []);

  const filtered = useMemo(() => {
    if (!items) return [];
    const needle = query.trim().toLowerCase();
    return items.filter((item) => {
      const matchesText = needle === "" || item.claim_text.toLowerCase().includes(needle);
      const matchesType = typeFilter === "all" || item.discrepancy_type === typeFilter;
      return matchesText && matchesType;
    });
  }, [items, query, typeFilter]);

  const hasItems = (items?.length ?? 0) > 0;

  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <RecentHeader />

      {error && <p className="text-sm text-red-800">Couldn&apos;t load recent verifications.</p>}
      {!error && items === null && <p className="text-sm text-ink/50">Loading…</p>}
      {!error && items?.length === 0 && <p className="text-sm text-ink/50">No verifications yet.</p>}

      {!error && hasItems && (
        <RecentFilters
          query={query}
          onQueryChange={setQuery}
          typeFilter={typeFilter}
          onTypeFilterChange={setTypeFilter}
          filtered={filtered}
        />
      )}

      {!error && hasItems && filtered.length === 0 && (
        <p className="text-sm text-ink/50">No matches.</p>
      )}

      <ul className="flex flex-col gap-2">
        {filtered.map((item) => (
          <RecentRow key={item.id} item={item} />
        ))}
      </ul>
    </main>
  );
}
