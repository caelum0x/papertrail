"use client";

import Link from "next/link";
import { KindBadge } from "./KindBadge";
import type { TemplateDto } from "@/app/console/templates/api";

interface TemplateCardProps {
  template: TemplateDto;
  onDuplicate: (id: string) => void;
  duplicating: boolean;
}

// A single template tile in the grid. Links to the detail/editor page; the
// duplicate action is inline so users can clone without opening the template.
export function TemplateCard({
  template,
  onDuplicate,
  duplicating,
}: TemplateCardProps) {
  const fieldCount = template.body.fields.length;

  return (
    <div className="bg-white border border-ink/10 rounded-lg p-4 hover:border-accent transition-colors">
      <div className="flex items-start justify-between gap-2">
        <Link
          href={`/console/templates/${template.id}`}
          className="font-medium text-ink/80 hover:text-accent"
        >
          {template.name}
        </Link>
        <KindBadge kind={template.kind} />
      </div>

      {template.description ? (
        <p className="mt-2 text-sm text-ink/60 line-clamp-2">
          {template.description}
        </p>
      ) : (
        <p className="mt-2 text-sm text-ink/40 italic">No description.</p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-ink/40">
        {template.category ? (
          <span className="rounded px-2 py-0.5 bg-ink/5 text-ink/60">
            {template.category}
          </span>
        ) : null}
        <span>
          {fieldCount} field{fieldCount === 1 ? "" : "s"}
        </span>
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-ink/5 pt-3">
        <span className="text-xs text-ink/40">
          {new Date(template.created_at).toLocaleDateString()}
        </span>
        <div className="flex items-center gap-3 text-xs">
          <button
            type="button"
            onClick={() => onDuplicate(template.id)}
            disabled={duplicating}
            className="text-accent disabled:opacity-40"
          >
            {duplicating ? "Duplicating..." : "Duplicate"}
          </button>
          <Link
            href={`/console/templates/${template.id}`}
            className="text-ink/60 hover:text-accent"
          >
            Open
          </Link>
        </div>
      </div>
    </div>
  );
}
