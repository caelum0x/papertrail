"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  fetchTag,
  fetchTags,
  type TagDto,
} from "@/components/tags/api";
import TagDetail from "./TagDetail";
import TagUsageList from "./TagUsageList";

// Tag detail view. Composes a DetailHeader/editor (TagDetail) and a SidePanel
// (TagUsageList). Loads the tag plus the org vocabulary (for the parent picker).

export default function TagDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const [tag, setTag] = useState<TagDto | null>(null);
  const [allTags, setAllTags] = useState<TagDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    const [tagRes, listRes] = await Promise.all([
      fetchTag(id),
      fetchTags({ limit: 100 }),
    ]);
    if (!tagRes.success || !tagRes.data) {
      setError(tagRes.error ?? "Tag not found.");
      setLoading(false);
      return;
    }
    setTag(tagRes.data);
    setAllTags(listRes.success && listRes.data ? listRes.data : []);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleUpdated = useCallback((updated: TagDto) => {
    setTag(updated);
  }, []);

  return (
    <div className="max-w-5xl">
      <Link
        href="/console/settings/tags"
        className="text-sm text-ink/60 hover:text-accent"
      >
        ← Back to tags
      </Link>

      <div className="mt-4">
        {loading ? (
          <p className="text-sm text-ink/40">Loading tag…</p>
        ) : error || !tag ? (
          <div className="rounded-lg border border-ink/15 bg-white p-5">
            <p className="text-sm text-red-600">{error ?? "Tag not found."}</p>
            <Link
              href="/console/settings/tags"
              className="mt-2 inline-block text-sm text-accent hover:underline"
            >
              Return to taxonomy
            </Link>
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
            <TagDetail tag={tag} parents={allTags} onUpdated={handleUpdated} />
            <aside>
              <TagUsageList tagId={tag.id} />
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}
