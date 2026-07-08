import type { ProviderCatalogEntry } from "./types";

interface CatalogGridProps {
  catalog: ProviderCatalogEntry[];
  installedProviders: Set<string>;
  onInstall: (provider: ProviderCatalogEntry) => void;
}

// The grid of available providers to install; each card shows the provider's
// direction and an install / "add another" action.
export function CatalogGrid({
  catalog,
  installedProviders,
  onInstall,
}: CatalogGridProps) {
  return (
    <div className="mt-3 grid gap-4 sm:grid-cols-2">
      {catalog.map((p) => {
        const already = installedProviders.has(p.id);
        return (
          <div key={p.id} className="bg-white border border-ink/10 rounded-lg p-5">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-medium text-ink/80">{p.name}</div>
              <span className="text-xs text-ink/40 border border-ink/10 rounded px-2 py-0.5">
                {p.direction}
              </span>
            </div>
            <p className="mt-1 text-xs text-ink/40">{p.description}</p>
            <button
              onClick={() => onInstall(p)}
              className="mt-3 text-xs border border-ink/15 rounded px-3 py-1.5 hover:border-accent"
            >
              {already ? "Add another" : "Install"}
            </button>
          </div>
        );
      })}
    </div>
  );
}
