"use client";

export type DetailTab = "config" | "syncs" | "events";

interface TabsProps {
  active: DetailTab;
  onChange: (tab: DetailTab) => void;
}

const TAB_DEFS: ReadonlyArray<{ key: DetailTab; label: string }> = [
  { key: "config", label: "Configuration" },
  { key: "syncs", label: "Sync history" },
  { key: "events", label: "Events" },
];

// In-page tab switcher for the connector detail view.
export function Tabs({ active, onChange }: TabsProps) {
  return (
    <nav className="mt-6 flex gap-1 border-b border-ink/10">
      {TAB_DEFS.map((t) => {
        const isActive = t.key === active;
        return (
          <button
            key={t.key}
            onClick={() => onChange(t.key)}
            className={
              isActive
                ? "border-b-2 border-accent px-3 py-2 text-sm font-medium text-ink/80"
                : "border-b-2 border-transparent px-3 py-2 text-sm text-ink/50 hover:text-ink/80"
            }
          >
            {t.label}
          </button>
        );
      })}
    </nav>
  );
}
