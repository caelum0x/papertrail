"use client";

import { useEffect, useState } from "react";
import { SourcesHeader } from "./_components/SourcesHeader";
import { SourcesFilters } from "./_components/SourcesFilters";
import { SourceRow } from "./_components/SourceRow";
import type { SourceItem, TypeFilter } from "./_components/sourceBadge";

export default function SourcesPage() {
  const [items, setItems] = useState<SourceItem[] | null>(null);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");

  useEffect(() => {
    let active = true;
    fetch("/api/sources")
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

  const normalizedQuery = query.trim().toLowerCase();
  const filteredItems = items?.filter((item) => {
    if (typeFilter !== "all" && item.source_type !== typeFilter) return false;
    if (!normalizedQuery) return true;
    const haystack = `${item.title ?? ""} ${item.external_id}`.toLowerCase();
    return haystack.includes(normalizedQuery);
  });

  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <SourcesHeader />

      {!error && items && items.length > 0 && (
        <SourcesFilters
          query={query}
          onQueryChange={setQuery}
          typeFilter={typeFilter}
          onTypeFilterChange={setTypeFilter}
        />
      )}

      {error && <p className="text-sm text-red-800">Couldn&apos;t load cached sources.</p>}
      {!error && items === null && <p className="text-sm text-ink/50">Loading…</p>}
      {!error && items?.length === 0 && <p className="text-sm text-ink/50">No cached sources yet.</p>}
      {!error && filteredItems?.length === 0 && items && items.length > 0 && (
        <p className="text-sm text-ink/50">No sources match your filter.</p>
      )}

      <ul className="flex flex-col gap-2">
        {filteredItems?.map((item) => (
          <SourceRow key={item.id} item={item} />
        ))}
      </ul>
    </main>
  );
}
