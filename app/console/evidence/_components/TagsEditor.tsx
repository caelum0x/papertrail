import type { FormEvent } from "react";
import { TagBadge } from "@/components/evidence/EvidenceBadges";

// Tag list with add/remove controls for the evidence detail page.

interface TagsEditorProps {
  tags: string[];
  newTag: string;
  error: string | null;
  onNewTagChange: (value: string) => void;
  onAddTag: (e: FormEvent) => void;
  onRemoveTag: (tag: string) => void;
}

export function TagsEditor({
  tags,
  newTag,
  error,
  onNewTagChange,
  onAddTag,
  onRemoveTag,
}: TagsEditorProps) {
  return (
    <section className="mt-6 bg-white border border-ink/15 rounded-lg p-5">
      <h2 className="text-sm font-medium text-ink/70">Tags</h2>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {tags.length > 0 ? (
          tags.map((tag) => (
            <TagBadge key={tag} tag={tag} onRemove={onRemoveTag} />
          ))
        ) : (
          <span className="text-sm text-ink/40">No tags yet.</span>
        )}
      </div>
      <form onSubmit={onAddTag} className="mt-3 flex gap-2">
        <input
          value={newTag}
          onChange={(e) => onNewTagChange(e.target.value)}
          placeholder="Add a tag"
          className="flex-1 rounded border border-ink/15 px-3 py-1.5 text-sm focus:outline-none focus:border-accent"
        />
        <button
          type="submit"
          disabled={newTag.trim().length === 0}
          className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          Add
        </button>
      </form>
      {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
    </section>
  );
}
