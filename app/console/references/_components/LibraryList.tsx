import Link from "next/link";
import type { ReferenceLibraryDto } from "../api";

function LibraryCard({ library }: { library: ReferenceLibraryDto }) {
  return (
    <Link
      href={`/console/references/${library.id}`}
      className="block bg-white border border-ink/15 rounded-lg p-4 hover:border-accent"
    >
      <div className="flex items-center justify-between">
        <span className="font-medium text-ink/80">{library.name}</span>
        <span className="text-xs rounded px-2 py-0.5 bg-accent/10 text-accent">
          {library.referenceCount ?? 0} refs
        </span>
      </div>
      <p className="mt-1 text-xs text-ink/40">
        Created {new Date(library.createdAt).toLocaleDateString()}
      </p>
    </Link>
  );
}

interface LibraryListProps {
  libraries: ReferenceLibraryDto[];
}

// Vertical list of reference-library cards.
export function LibraryList({ libraries }: LibraryListProps) {
  return (
    <ul className="space-y-2">
      {libraries.map((lib) => (
        <li key={lib.id}>
          <LibraryCard library={lib} />
        </li>
      ))}
    </ul>
  );
}
