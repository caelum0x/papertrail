"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchTags,
  type TagDto,
} from "@/components/tags/api";
import TagFilters from "./TagFilters";
import TagRow from "./TagRow";
import Pagination from "./Pagination";

// Flat, paginated, searchable table of every tag. Composes Filters + Table (Rows)
// + Pagination. Notifies the parent when the tag set changes so the tree/form
// stay in sync. Owns its own loading/empty/error states.

const PAGE_LIMIT = 20;

interface TagManagerProps {
  // A lookup for resolving parent names in each row without extra fetches.
  allTags: TagDto[];
  onChanged: () => void;
}

export default function TagManager({ allTags, onChanged }: TagManagerProps) {
  const [tags, setTags] = useState<TagDto[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const parentNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of allTags) map.set(t.id, t.name);
    return map;
  }, [allTags]);

  const load = useCallback(
    async (p: number, q: string) => {
      setLoading(true);
      setError(null);
      const res = await fetchTags({
        page: p,
        limit: PAGE_LIMIT,
        search: q || undefined,
      });
      if (!res.success || !res.data) {
        setError(res.error ?? "Failed to load tags.");
        setLoading(false);
        return;
      }
      setTags(res.data);
      setTotal(res.meta?.total ?? res.data.length);
      setLoading(false);
    },
    []
  );

  useEffect(() => {
    void load(page, search);
  }, [load, page, search]);

  // Reset to page 1 whenever the search term changes.
  const handleSearchChange = useCallback((value: string) => {
    setSearch(value);
    setPage(1);
  }, []);

  const handleDeleted = useCallback(
    (id: string) => {
      setTags((prev) => prev.filter((t) => t.id !== id));
      setTotal((prev) => Math.max(0, prev - 1));
      onChanged();
    },
    [onChanged]
  );

  const totalPages = Math.max(1, Math.ceil(total / PAGE_LIMIT));

  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-ink/80">All tags</h2>
        <TagFilters search={search} onSearchChange={handleSearchChange} />
      </div>

      <div className="mt-3 overflow-hidden rounded-lg border border-ink/10 bg-white">
        {loading ? (
          <p className="p-4 text-sm text-ink/40">Loading tags…</p>
        ) : error ? (
          <p className="p-4 text-sm text-red-600">{error}</p>
        ) : tags.length === 0 ? (
          <p className="p-4 text-sm text-ink/40">
            {search ? "No tags match your filter." : "No tags yet."}
          </p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-ink/40">
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Parent</th>
                <th className="px-3 py-2 font-medium">Uses</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {tags.map((tag) => (
                <TagRow
                  key={tag.id}
                  tag={tag}
                  parentName={tag.parentId ? parentNames.get(tag.parentId) ?? null : null}
                  onDeleted={handleDeleted}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
    </div>
  );
}
