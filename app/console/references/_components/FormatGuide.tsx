interface FormatEntry {
  name: string;
  extension: string;
  canImport: boolean;
  canExport: boolean;
  description: string;
}

const FORMATS: FormatEntry[] = [
  {
    name: "BibTeX",
    extension: ".bib",
    canImport: true,
    canExport: true,
    description:
      "LaTeX-native citation format. Import pasted @article/@misc entries or export a whole library for use in a manuscript.",
  },
  {
    name: "RIS",
    extension: ".ris",
    canImport: true,
    canExport: true,
    description:
      "Tagged format understood by EndNote, Zotero, and Mendeley. Each record runs from TY to ER.",
  },
  {
    name: "CSV",
    extension: ".csv",
    canImport: false,
    canExport: true,
    description:
      "Flat spreadsheet export with one row per reference — handy for review in Excel or Sheets. Not supported for import.",
  },
];

function Badge({ label, on }: { label: string; on: boolean }) {
  return (
    <span
      className={`text-xs rounded px-2 py-0.5 ${
        on ? "bg-accent/10 text-accent" : "bg-ink/5 text-ink/40"
      }`}
    >
      {on ? label : `No ${label.toLowerCase()}`}
    </span>
  );
}

// Static reference card grid documenting supported citation formats.
export function FormatGuide() {
  return (
    <div className="space-y-3">
      {FORMATS.map((f) => (
        <div
          key={f.name}
          className="bg-white border border-ink/15 rounded-lg p-4"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="font-medium text-ink/80">{f.name}</span>
              <span className="text-xs text-ink/40">{f.extension}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Badge label="Import" on={f.canImport} />
              <Badge label="Export" on={f.canExport} />
            </div>
          </div>
          <p className="mt-2 text-sm text-ink/60">{f.description}</p>
        </div>
      ))}
    </div>
  );
}
