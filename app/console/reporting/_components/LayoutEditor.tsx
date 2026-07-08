"use client";

import type { LayoutSection } from "@/lib/reporting/types";

interface LayoutEditorProps {
  sections: LayoutSection[];
  onChange: (sections: LayoutSection[]) => void;
}

const SECTION_KINDS: LayoutSection["kind"][] = [
  "metric",
  "table",
  "breakdown",
  "text",
];

function makeId(): string {
  return `sec_${Math.random().toString(36).slice(2, 10)}`;
}

// Editor for a report's layout sections. Immutable updates only — every change
// produces a new sections array rather than mutating the existing one.
export function LayoutEditor({ sections, onChange }: LayoutEditorProps) {
  const addSection = () => {
    onChange([
      ...sections,
      { id: makeId(), title: "New section", kind: "metric" },
    ]);
  };

  const updateSection = (index: number, patch: Partial<LayoutSection>) => {
    onChange(sections.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  };

  const removeSection = (index: number) => {
    onChange(sections.filter((_, i) => i !== index));
  };

  return (
    <div className="rounded-lg border border-ink/15 bg-white p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink/80">Layout</h2>
        <button
          type="button"
          onClick={addSection}
          className="rounded-md border border-ink/15 bg-white px-2.5 py-1 text-xs text-ink/70 hover:bg-paper"
        >
          Add section
        </button>
      </div>

      {sections.length === 0 ? (
        <p className="mt-3 text-sm text-ink/40">
          No sections yet. Add one to shape the report.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {sections.map((section, index) => (
            <li
              key={section.id}
              className="flex flex-wrap items-center gap-2 rounded-md border border-ink/10 bg-paper p-2"
            >
              <input
                value={section.title}
                onChange={(e) => updateSection(index, { title: e.target.value })}
                placeholder="Section title"
                className="min-w-[8rem] flex-1 rounded border border-ink/15 bg-white px-2 py-1 text-sm"
                aria-label="Section title"
              />
              <select
                value={section.kind}
                onChange={(e) =>
                  updateSection(index, {
                    kind: e.target.value as LayoutSection["kind"],
                  })
                }
                className="rounded border border-ink/15 bg-white px-2 py-1 text-sm"
                aria-label="Section kind"
              >
                {SECTION_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => removeSection(index)}
                className="text-xs text-red-700 hover:underline"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
