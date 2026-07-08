"use client";

import Link from "next/link";
import { KindBadge } from "./KindBadge";
import type { TemplateDto } from "@/app/console/templates/api";

interface TemplateHeaderProps {
  template: TemplateDto;
  duplicating: boolean;
  deleting: boolean;
  onDuplicate: () => void;
  onDelete: () => void;
}

// Detail-page header for a single template: breadcrumb back link, name + kind,
// created-by meta, and the duplicate/delete actions.
export function TemplateHeader({
  template,
  duplicating,
  deleting,
  onDuplicate,
  onDelete,
}: TemplateHeaderProps) {
  const creator =
    template.created_by_name || template.created_by_email || "Unknown";

  return (
    <div>
      <Link
        href="/console/templates"
        className="text-sm text-ink/40 hover:text-accent"
      >
        &larr; Templates
      </Link>

      <div className="mt-2 flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold text-ink/80">
              {template.name}
            </h1>
            <KindBadge kind={template.kind} />
          </div>
          <p className="mt-1 text-sm text-ink/40">
            {template.category ? `${template.category} · ` : ""}
            Created by {creator} on{" "}
            {new Date(template.created_at).toLocaleDateString()}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onDuplicate}
            disabled={duplicating}
            className="text-sm border border-ink/15 text-ink/70 rounded px-3 py-2 hover:border-accent disabled:opacity-50"
          >
            {duplicating ? "Duplicating..." : "Duplicate"}
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={deleting}
            className="text-sm border border-red-200 text-red-600 rounded px-3 py-2 hover:border-red-400 disabled:opacity-50"
          >
            {deleting ? "Deleting..." : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}
