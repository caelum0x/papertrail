"use client";

// The notes textarea + Match button, with a prominent de-identification reminder.
// Presentational: the parent owns the notes state and the submit handler.

interface PatientInputProps {
  notes: string;
  onChange: (value: string) => void;
  onMatch: () => void;
  loading: boolean;
  error: string | null;
}

const MIN_CHARS = 10;
const MAX_CHARS = 20000;

export function PatientInput({ notes, onChange, onMatch, loading, error }: PatientInputProps) {
  const tooShort = notes.trim().length < MIN_CHARS;
  const tooLong = notes.length > MAX_CHARS;

  return (
    <div className="rounded-lg border border-ink/15 bg-white p-4">
      <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
        <strong className="font-semibold">De-identify before pasting.</strong> Paste only
        clinical facts. Do not include patient names, MRNs, dates of birth, addresses, or other
        identifiers — they are never extracted or stored, and PaperTrail keeps no copy of the raw
        notes.
      </div>

      <label className="block text-sm font-medium text-ink/70" htmlFor="notes">
        De-identified patient notes
      </label>
      <textarea
        id="notes"
        rows={8}
        value={notes}
        onChange={(e) => onChange(e.target.value)}
        placeholder="e.g. 62-year-old male, stage IV EGFR-mutated non-small cell lung cancer. ECOG 1. Prior treatment with osimertinib, progressed. eGFR 68. No known brain metastases."
        className="mt-1 w-full resize-y rounded-md border border-ink/15 bg-white px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none"
      />

      <div className="mt-2 flex items-center justify-between">
        <span className="text-xs text-ink/40">
          {notes.length.toLocaleString()} / {MAX_CHARS.toLocaleString()} characters
        </span>
        <button
          type="button"
          onClick={onMatch}
          disabled={loading || tooShort || tooLong}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {loading ? "Matching…" : "Match trials"}
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
