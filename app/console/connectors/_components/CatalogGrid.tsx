import type { CatalogEntryView } from "./types";
import { ProviderCard } from "./ProviderCard";

interface CatalogGridProps {
  entries: CatalogEntryView[];
  onInstall: (entry: CatalogEntryView) => void;
  canEdit: boolean;
  installingProvider: string | null;
}

// Responsive grid of provider tiles used by both the catalog page and the
// installed page's "add a connector" section.
export function CatalogGrid({
  entries,
  onInstall,
  canEdit,
  installingProvider,
}: CatalogGridProps) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {entries.map((entry) => (
        <ProviderCard
          key={entry.provider}
          entry={entry}
          onInstall={onInstall}
          canEdit={canEdit}
          installing={installingProvider === entry.provider}
        />
      ))}
    </div>
  );
}
