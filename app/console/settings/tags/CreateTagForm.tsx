"use client";

import { useState } from "react";
import { createTag, type TagDto } from "@/components/tags/api";

// Colocated create form. A field-group component: name, color, and optional
// parent. Calls back to the parent on success so the tree/list can refresh.

const PRESET_COLORS = [
  "#64748b",
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#06b6d4",
  "#6366f1",
  "#a855f7",
  "#ec4899",
];

interface CreateTagFormProps {
  parents: TagDto[];
  onCreated: (tag: TagDto) => void;
}

export default function CreateTagForm({ parents, onCreated }: CreateTagFormProps) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(PRESET_COLORS[0]);
  const [parentId, setParentId] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Name is required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const res = await createTag({
      name: trimmed,
      color,
      parentId: parentId || null,
    });
    if (!res.success || !res.data) {
      setError(res.error ?? "Failed to create tag.");
      setSubmitting(false);
      return;
    }
    onCreated(res.data);
    setName("");
    setColor(PRESET_COLORS[0]);
    setParentId("");
    setSubmitting(false);
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-lg border border-ink/10 bg-white p-4"
    >
      <h3 className="text-sm font-medium text-ink/80">New tag</h3>

      <div className="mt-3 space-y-3">
        <div>
          <label className="block text-xs font-medium text-ink/60" htmlFor="tag-name">
            Name
          </label>
          <input
            id="tag-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            placeholder="e.g. Cardiology"
            className="mt-1 w-full rounded border border-ink/15 px-2 py-1.5 text-sm outline-none focus:border-accent"
          />
        </div>

        <div>
          <span className="block text-xs font-medium text-ink/60">Color</span>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Color ${c}`}
                onClick={() => setColor(c)}
                className={`h-6 w-6 rounded-full border-2 ${
                  color === c ? "border-ink/60" : "border-transparent"
                }`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-ink/60" htmlFor="tag-parent">
            Parent (optional)
          </label>
          <select
            id="tag-parent"
            value={parentId}
            onChange={(e) => setParentId(e.target.value)}
            className="mt-1 w-full rounded border border-ink/15 bg-white px-2 py-1.5 text-sm outline-none focus:border-accent"
          >
            <option value="">— None (top level) —</option>
            {parents.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        {error ? <p className="text-xs text-red-600">{error}</p> : null}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded bg-accent px-3 py-2 text-sm text-white hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? "Creating…" : "Create tag"}
        </button>
      </div>
    </form>
  );
}
