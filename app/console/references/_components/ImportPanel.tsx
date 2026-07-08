"use client";

type ImportFormat = "bibtex" | "ris";

interface ImportPanelProps {
  format: ImportFormat;
  text: string;
  importing: boolean;
  message: string | null;
  error: string | null;
  onFormatChange: (format: ImportFormat) => void;
  onTextChange: (text: string) => void;
  onImport: () => void;
}

// Collapsible import form: pick BibTeX/RIS, paste text, submit.
export function ImportPanel({
  format,
  text,
  importing,
  message,
  error,
  onFormatChange,
  onTextChange,
  onImport,
}: ImportPanelProps) {
  return (
    <div className="mt-4 bg-white border border-ink/15 rounded-lg p-5 space-y-3">
      <div className="flex items-center gap-3">
        <label className="text-sm text-ink/70">Format</label>
        <select
          value={format}
          onChange={(e) => onFormatChange(e.target.value as ImportFormat)}
          className="text-sm border border-ink/15 rounded px-2 py-1 focus:outline-none focus:border-accent"
        >
          <option value="bibtex">BibTeX</option>
          <option value="ris">RIS</option>
        </select>
      </div>
      <textarea
        value={text}
        onChange={(e) => onTextChange(e.target.value)}
        rows={8}
        placeholder={
          format === "bibtex"
            ? "@article{key, title = {...}, author = {...}, year = {2024} }"
            : "TY  - JOUR\nTI  - ...\nER  - "
        }
        className="w-full font-mono text-xs border border-ink/15 rounded px-3 py-2 focus:outline-none focus:border-accent"
      />
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {message ? <p className="text-sm text-green-700">{message}</p> : null}
      <button
        onClick={onImport}
        disabled={importing}
        className="text-sm bg-accent text-white rounded px-3 py-2 hover:opacity-90 disabled:opacity-50"
      >
        {importing ? "Importing..." : "Import references"}
      </button>
    </div>
  );
}
