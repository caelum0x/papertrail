"use client";

import Link from "next/link";
import type { ReferenceLibraryDto } from "../api";

type ExportFormat = "bibtex" | "ris" | "csv";

interface LibraryDetailHeaderProps {
  library: ReferenceLibraryDto | null;
  total: number;
  importOpen: boolean;
  onToggleImport: () => void;
  onExport: (format: ExportFormat) => void;
}

// Breadcrumb, title, reference count, and the import toggle + export toolbar.
export function LibraryDetailHeader({
  library,
  total,
  importOpen,
  onToggleImport,
  onExport,
}: LibraryDetailHeaderProps) {
  return (
    <>
      <div className="flex items-center gap-2 text-sm text-ink/40">
        <Link href="/console/references" className="hover:text-accent">
          Reference libraries
        </Link>
        <span>/</span>
        <span className="text-ink/60">{library?.name ?? "Library"}</span>
      </div>

      <div className="mt-2 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-ink/80">
            {library?.name ?? "Library"}
          </h1>
          <p className="mt-1 text-sm text-ink/40">
            {library ? `${library.referenceCount ?? total} reference(s)` : " "}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onToggleImport}
            className="text-sm bg-accent text-white rounded px-3 py-2 hover:opacity-90"
          >
            {importOpen ? "Close import" : "Import"}
          </button>
          <div className="flex items-center gap-1 text-sm">
            <span className="text-ink/40">Export:</span>
            <button
              onClick={() => onExport("bibtex")}
              className="text-accent hover:underline"
            >
              BibTeX
            </button>
            <span className="text-ink/20">|</span>
            <button
              onClick={() => onExport("ris")}
              className="text-accent hover:underline"
            >
              RIS
            </button>
            <span className="text-ink/20">|</span>
            <button
              onClick={() => onExport("csv")}
              className="text-accent hover:underline"
            >
              CSV
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
