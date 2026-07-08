"use client";

import { useCallback, useEffect, useState } from "react";
import {
  fetchTagTree,
  fetchTags,
  type TagTreeNodeDto,
  type TagDto,
} from "@/components/tags/api";
import ModuleHeader from "./ModuleHeader";
import TaxonomyTree from "./TaxonomyTree";
import CreateTagForm from "./CreateTagForm";
import TagManager from "./TagManager";
import EmptyState from "./EmptyState";

// Tag taxonomy hub. Composes the tree view, the flat manager table, and the
// create form. Holds the shared tag vocabulary so children don't each re-fetch
// the full list; a single reload() refreshes everything after any mutation.

export default function TagsPage() {
  const [tree, setTree] = useState<TagTreeNodeDto[]>([]);
  const [allTags, setAllTags] = useState<TagDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Bumped to force TagManager to re-fetch its current page after mutations.
  const [refreshKey, setRefreshKey] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [treeRes, listRes] = await Promise.all([
      fetchTagTree(),
      fetchTags({ limit: 100 }),
    ]);
    if (!treeRes.success || !treeRes.data) {
      setError(treeRes.error ?? "Failed to load taxonomy.");
      setLoading(false);
      return;
    }
    setTree(treeRes.data);
    setAllTags(listRes.success && listRes.data ? listRes.data : []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const reload = useCallback(() => {
    setRefreshKey((k) => k + 1);
    void load();
  }, [load]);

  const handleCreated = useCallback(() => {
    reload();
  }, [reload]);

  return (
    <div className="max-w-5xl">
      <ModuleHeader total={allTags.length} />

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_18rem]">
        <div className="space-y-6">
          <section>
            <h2 className="mb-3 text-sm font-medium text-ink/80">Taxonomy</h2>
            {loading ? (
              <p className="text-sm text-ink/40">Loading taxonomy…</p>
            ) : error ? (
              <div className="rounded-lg border border-ink/15 bg-white p-5">
                <p className="text-sm text-red-600">{error}</p>
                <button
                  type="button"
                  onClick={() => void load()}
                  className="mt-2 text-sm text-accent hover:underline"
                >
                  Retry
                </button>
              </div>
            ) : tree.length === 0 ? (
              <EmptyState />
            ) : (
              <TaxonomyTree nodes={tree} />
            )}
          </section>

          <section>
            <TagManager key={refreshKey} allTags={allTags} onChanged={reload} />
          </section>
        </div>

        <aside>
          <CreateTagForm parents={allTags} onCreated={handleCreated} />
        </aside>
      </div>
    </div>
  );
}
