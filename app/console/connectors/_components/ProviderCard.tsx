import { categoryLabel, providerGlyph } from "./shared";
import type { CatalogEntryView } from "./types";

interface ProviderCardProps {
  entry: CatalogEntryView;
  onInstall: (entry: CatalogEntryView) => void;
  canEdit: boolean;
  installing: boolean;
}

// A single provider tile in the catalog grid. Shows the provider, a short blurb,
// its capability chips, and an install action (gated to editors).
export function ProviderCard({
  entry,
  onInstall,
  canEdit,
  installing,
}: ProviderCardProps) {
  const caps = entry.capabilities;
  const chips: string[] = [];
  if (caps.sync) chips.push("Sync");
  if (caps.events) chips.push("Events");
  if (caps.test) chips.push("Test");

  return (
    <div className="flex flex-col rounded-lg border border-ink/10 bg-white p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-ink/5 text-sm font-semibold text-ink/70">
          {providerGlyph(entry.provider)}
        </div>
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-ink/80">
            {entry.name}
          </h3>
          <p className="text-xs text-ink/40">{categoryLabel(entry.category)}</p>
        </div>
      </div>

      <p className="mt-3 flex-1 text-sm text-ink/60">{entry.description}</p>

      {chips.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1">
          {chips.map((c) => (
            <span
              key={c}
              className="rounded bg-ink/5 px-1.5 py-0.5 text-xs text-ink/50"
            >
              {c}
            </span>
          ))}
        </div>
      ) : null}

      <button
        onClick={() => onInstall(entry)}
        disabled={!canEdit || installing}
        className="mt-4 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
      >
        {installing ? "Installing…" : "Install"}
      </button>
      {!canEdit ? (
        <p className="mt-2 text-xs text-ink/40">Editor role required to install.</p>
      ) : null}
    </div>
  );
}
