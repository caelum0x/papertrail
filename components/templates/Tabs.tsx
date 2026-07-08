"use client";

export interface TabItem {
  id: string;
  label: string;
}

interface TabsProps {
  tabs: TabItem[];
  active: string;
  onChange: (id: string) => void;
}

// Simple underline tab strip used on the template detail page to switch between
// the editor and the preview panels.
export function Tabs({ tabs, active, onChange }: TabsProps) {
  return (
    <div className="border-b border-ink/10">
      <nav className="flex gap-4">
        {tabs.map((tab) => {
          const isActive = tab.id === active;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onChange(tab.id)}
              className={`-mb-px border-b-2 px-1 py-2 text-sm ${
                isActive
                  ? "border-accent text-accent"
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
