"use client";

import { TemplateCard } from "./TemplateCard";
import { NewTemplateCard } from "./NewTemplateCard";
import type { TemplateDto } from "@/app/console/templates/api";

interface TemplateGridProps {
  templates: TemplateDto[];
  duplicatingId: string | null;
  onDuplicate: (id: string) => void;
}

// Responsive grid of template tiles with the "new template" CTA always in the
// first slot. Assumes the parent has already handled loading/empty/error states.
export function TemplateGrid({
  templates,
  duplicatingId,
  onDuplicate,
}: TemplateGridProps) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <NewTemplateCard />
      {templates.map((t) => (
        <TemplateCard
          key={t.id}
          template={t}
          onDuplicate={onDuplicate}
          duplicating={duplicatingId === t.id}
        />
      ))}
    </div>
  );
}
