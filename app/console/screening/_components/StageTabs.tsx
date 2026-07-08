import type { ScreeningStage } from "@/app/api/sr-projects/lib/types";

// Which screening stage a queue tab drives, and which record statuses it shows.
export interface StageTab {
  key: "title" | "fulltext";
  label: string;
  stage: ScreeningStage;
  status: string;
}

export const STAGE_TABS: StageTab[] = [
  {
    key: "title",
    label: "Title / Abstract",
    stage: "title_abstract",
    status: "pending",
  },
  {
    key: "fulltext",
    label: "Full text",
    stage: "full_text",
    status: "title_included",
  },
];

interface StageTabsProps {
  active: "title" | "fulltext";
  onSelect: (key: "title" | "fulltext") => void;
}

export function StageTabs({ active, onSelect }: StageTabsProps) {
  return (
    <div className="mt-6 inline-flex rounded-lg border border-ink/15 bg-white p-0.5">
      {STAGE_TABS.map((t) => (
        <button
          key={t.key}
          onClick={() => onSelect(t.key)}
          className={`rounded-md px-3 py-1.5 text-sm ${
            active === t.key
              ? "bg-paper text-accent font-medium"
              : "text-ink/60 hover:text-ink/80"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
