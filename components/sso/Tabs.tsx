"use client";

// Minimal tab bar for the connection detail view. Controlled by the parent so it
// stays a pure presentational component.

export interface TabDef {
  id: string;
  label: string;
}

interface TabsProps {
  tabs: TabDef[];
  active: string;
  onChange: (id: string) => void;
}

export function Tabs({ tabs, active, onChange }: TabsProps) {
  return (
    <div className="border-b border-ink/10">
      <nav className="flex gap-6" role="tablist">
        {tabs.map((tab) => {
          const isActive = tab.id === active;
          return (
            <button
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              onClick={() => onChange(tab.id)}
              className={`pb-2 -mb-px text-sm border-b-2 transition-colors ${
                isActive
                  ? "border-accent text-ink/80"
                  : "border-transparent text-ink/50 hover:text-ink/80"
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
