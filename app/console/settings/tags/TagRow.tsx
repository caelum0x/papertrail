"use client";

import { useState } from "react";
import Link from "next/link";
import { deleteTag, type TagDto } from "@/components/tags/api";

// A single row in the flat tag table. Handles inline delete with a confirm step.

interface TagRowProps {
  tag: TagDto;
  parentName: string | null;
  onDeleted: (id: string) => void;
}

export default function TagRow({ tag, parentName, onDeleted }: TagRowProps) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDelete = async () => {
    setBusy(true);
    setError(null);
    const res = await deleteTag(tag.id);
    if (!res.success) {
      setError(res.error ?? "Failed to delete.");
      setBusy(false);
      return;
    }
    onDeleted(tag.id);
  };

  return (
    <tr className="border-t border-ink/10">
      <td className="px-3 py-2">
        <Link
          href={`/console/settings/tags/${tag.id}`}
          className="inline-flex items-center gap-2 text-ink/80 hover:text-accent"
        >
          <span
            aria-hidden
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: tag.color }}
          />
          {tag.name}
        </Link>
      </td>
      <td className="px-3 py-2 text-ink/60">{parentName ?? "—"}</td>
      <td className="px-3 py-2 text-ink/60">{tag.usageCount ?? 0}</td>
      <td className="px-3 py-2 text-right">
        {error ? (
          <span className="text-xs text-red-600">{error}</span>
        ) : confirming ? (
          <span className="inline-flex items-center gap-2">
            <button
              type="button"
              onClick={handleDelete}
              disabled={busy}
              className="text-xs text-red-600 hover:underline disabled:opacity-50"
            >
              {busy ? "Deleting…" : "Confirm"}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={busy}
              className="text-xs text-ink/40 hover:text-ink/80"
            >
              Cancel
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="text-xs text-ink/40 hover:text-red-600"
          >
            Delete
          </button>
        )}
      </td>
    </tr>
  );
}
