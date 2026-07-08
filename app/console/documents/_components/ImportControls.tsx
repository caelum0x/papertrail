import type { RefObject } from "react";

// File picker + run/clear controls for the bulk import flow.

interface ImportControlsProps {
  inputRef: RefObject<HTMLInputElement>;
  running: boolean;
  forbidden: boolean;
  itemCount: number;
  doneCount: number;
  onSelectFiles: (files: FileList | null) => void;
  onRun: () => void;
  onClear: () => void;
}

export function ImportControls({
  inputRef,
  running,
  forbidden,
  itemCount,
  doneCount,
  onSelectFiles,
  onRun,
  onClear,
}: ImportControlsProps) {
  return (
    <div className="mt-6 bg-white border border-ink/15 rounded-lg p-5">
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        multiple
        disabled={running}
        onChange={(e) => onSelectFiles(e.target.files)}
        className="block w-full text-sm text-ink/70 file:mr-4 file:rounded file:border-0 file:bg-accent file:px-4 file:py-2 file:text-sm file:font-medium file:text-white disabled:opacity-50"
      />

      {forbidden ? (
        <p className="mt-3 text-sm text-red-600">
          You don&apos;t have permission to import documents.
        </p>
      ) : null}

      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={onRun}
          disabled={running || itemCount === 0}
          className="rounded bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {running
            ? "Importing..."
            : `Import ${itemCount} file${itemCount === 1 ? "" : "s"}`}
        </button>
        <button
          onClick={onClear}
          disabled={running || itemCount === 0}
          className="text-sm text-ink/60 disabled:opacity-40"
        >
          Clear
        </button>
        {itemCount > 0 ? (
          <span className="text-xs text-ink/40">
            {doneCount} of {itemCount} done
          </span>
        ) : null}
      </div>
    </div>
  );
}
