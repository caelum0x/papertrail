"use client";

import { EXAMPLE_NOTES } from "./example";

// Capture panel: a bench scientist pastes rough notes or a voice-memo transcript and
// hits "Structure with Claude". Purely controlled — the parent owns the notes value and
// the submit action, so it can re-use the notes when the record is saved. A one-click
// "Try an example" loads realistic bench notes client-side so a first-time user reaches
// the full flow without writing anything.

interface CaptureProps {
  notes: string;
  onChange: (value: string) => void;
  onStructure: () => void;
  loading: boolean;
  error: string | null;
  // When true the error is an honest upstream/degraded condition (Claude AI temporarily
  // unavailable / network) — recoverable, so we render it as a yellow notice with a retry
  // affordance rather than a red hard failure. The panel never white-screens either way.
  degraded: boolean;
}

const MAX_NOTES = 20000;

// Truncated placeholder — the full realistic example is one click away via "Try an example".
const PLACEHOLDER =
  "e.g. 6/12 — thawed HEK293T p12, seeded 2x10^5/well in 6-well. Next day transfected 2ug pcDNA3-TP53 w/ Lipofectamine 3000 per Thermo protocol. 48h harvested, western for p53 (CST #9282, 1:1000). Strong band ~53kDa in transfected, none in mock. Next: repeat w/ dose curve.";

export function Capture({
  notes,
  onChange,
  onStructure,
  loading,
  error,
  degraded,
}: CaptureProps) {
  const tooLong = notes.length > MAX_NOTES;
  const empty = notes.trim().length === 0;
  const disabled = loading || empty || tooLong;

  return (
    <div className="rounded-lg border border-ink/15 bg-white p-4">
      <label className="block text-sm font-medium text-ink/70" htmlFor="notes">
        Bench notes
      </label>
      <p className="mt-0.5 text-xs text-ink/40">
        Paste rough notes or a voice-memo transcript. Claude structures them into a
        reproducible record — every quoted field grounded to your exact words.
      </p>
      <p className="mt-1 text-xs text-ink/40">
        <span className="font-medium text-ink/50">The grounding contract:</span> each
        extracted field carries a verbatim quote from your notes. If Claude can&rsquo;t
        find the exact text, that item is dropped, never invented.
      </p>
      <textarea
        id="notes"
        rows={12}
        value={notes}
        onChange={(e) => onChange(e.target.value)}
        placeholder={PLACEHOLDER}
        className="mt-2 w-full rounded-md border border-ink/15 bg-white px-3 py-2 font-mono text-sm text-ink focus:border-accent focus:outline-none"
      />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <span className={`text-xs ${tooLong ? "text-red-700" : "text-ink/40"}`}>
          {notes.length.toLocaleString()} / {MAX_NOTES.toLocaleString()} chars
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onChange(EXAMPLE_NOTES)}
            disabled={loading}
            className="rounded-md border border-ink/15 px-3 py-2 text-sm font-medium text-ink/70 hover:border-ink/30 hover:bg-ink/[0.03] disabled:opacity-50"
            title="Load realistic HEK293T transfection + western blot bench notes"
          >
            Try an example
          </button>
          <button
            type="button"
            onClick={onStructure}
            disabled={disabled}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {loading ? "Structuring…" : "Structure with Claude"}
          </button>
        </div>
      </div>
      {empty ? (
        <p className="mt-2 text-xs text-ink/40">
          New here? Click <span className="font-medium text-ink/60">Try an example</span>{" "}
          to load real bench notes, then{" "}
          <span className="font-medium text-ink/60">Structure with Claude</span>.
        </p>
      ) : null}

      {error ? (
        degraded ? (
          <div
            className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2"
            role="alert"
          >
            <p className="text-sm font-medium text-amber-800">
              AI structuring is temporarily unavailable
            </p>
            <p className="mt-0.5 text-xs text-amber-800/90">{error}</p>
            <button
              type="button"
              onClick={onStructure}
              disabled={disabled}
              className="mt-2 rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50"
            >
              {loading ? "Retrying…" : "Retry"}
            </button>
          </div>
        ) : (
          <p className="mt-3 text-sm text-red-700" role="alert">
            {error}
          </p>
        )
      ) : null}
    </div>
  );
}
