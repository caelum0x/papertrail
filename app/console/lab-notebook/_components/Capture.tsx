"use client";

// Capture panel: a bench scientist pastes rough notes or a voice-memo transcript and
// hits "Structure with Claude". Purely controlled — the parent owns the notes value and
// the submit action, so it can re-use the notes when the record is saved.

interface CaptureProps {
  notes: string;
  onChange: (value: string) => void;
  onStructure: () => void;
  loading: boolean;
  error: string | null;
}

const MAX_NOTES = 20000;

export function Capture({ notes, onChange, onStructure, loading, error }: CaptureProps) {
  const tooLong = notes.length > MAX_NOTES;
  const disabled = loading || notes.trim().length === 0 || tooLong;

  return (
    <div className="rounded-lg border border-ink/15 bg-white p-4">
      <label className="block text-sm font-medium text-ink/70" htmlFor="notes">
        Bench notes
      </label>
      <p className="mt-0.5 text-xs text-ink/40">
        Paste rough notes or a voice-memo transcript. Claude structures them into a
        reproducible record — every quoted field grounded to your exact words.
      </p>
      <textarea
        id="notes"
        rows={12}
        value={notes}
        onChange={(e) => onChange(e.target.value)}
        placeholder={
          "e.g. 6/12 — thawed HEK293T p12, seeded 2x10^5/well in 6-well. Next day transfected 2ug pcDNA3-TP53 w/ Lipofectamine 3000 per Thermo protocol. 48h harvested, western for p53 (CST #9282, 1:1000). Strong band ~53kDa in transfected, none in mock. Next: repeat w/ dose curve."
        }
        className="mt-2 w-full rounded-md border border-ink/15 bg-white px-3 py-2 font-mono text-sm text-ink focus:border-accent focus:outline-none"
      />
      <div className="mt-2 flex items-center justify-between">
        <span
          className={`text-xs ${tooLong ? "text-red-700" : "text-ink/40"}`}
        >
          {notes.length.toLocaleString()} / {MAX_NOTES.toLocaleString()} chars
        </span>
        <button
          type="button"
          onClick={onStructure}
          disabled={disabled}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {loading ? "Structuring…" : "Structure with Claude"}
        </button>
      </div>

      {error ? (
        <p className="mt-3 text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
