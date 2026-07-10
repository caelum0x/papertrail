"use client";

import { useCallback, useState } from "react";
import type { ApiResponse } from "@/lib/api/response";
import { SourceSearch } from "./SourceSearch";
import type { LoadedSkip } from "./CachedSourceLoader";
import type { RatioMeasure, StudyForm } from "./types";

// "Pick from cached sources" mode for the Evidence Workbench. Instead of pasting
// raw UUIDs (CachedSourceLoader), the reviewer SEARCHES the cached-source catalogue
// (SourceSearch → SourcePicker) and multi-selects rows. On "Run auto-synthesis" this
// POSTs the claim + selected ids to /api/auto-synthesis, which DETERMINISTICALLY
// extracts one poolable ratio effect per source and returns the pooled evidence
// report. We lift the extracted studies back into the workbench form rows (so the
// deterministic stack renders exactly as in manual mode) and surface which sources
// were skipped and why. NO LLM is in this path — every number traces to cached data.

interface ExtractedStudyWire {
  source_id: string;
  label: string;
  measure: RatioMeasure;
  point: number;
  ci_lower: number;
  ci_upper: number;
}

interface SkippedSourceWire {
  id: string;
  reason: string;
}

interface AutoSynthesisResponse {
  studies: ExtractedStudyWire[];
  skipped: SkippedSourceWire[];
  missing_source_ids: string[];
}

interface SourcePickerLoaderProps {
  claim: string;
  // Called with the extracted study rows once the sources synthesise successfully.
  onLoaded: (rows: StudyForm[], skips: LoadedSkip[]) => void;
  // Optional cap on how many sources may be pooled at once.
  maxSelected?: number;
}

let pickerSeq = 0;
function studyRowFrom(study: ExtractedStudyWire): StudyForm {
  pickerSeq += 1;
  return {
    id: `picked-${pickerSeq}`,
    label: study.label,
    measure: study.measure,
    point: String(study.point),
    ciLower: String(study.ci_lower),
    ciUpper: String(study.ci_upper),
  };
}

export function SourcePickerLoader({
  claim,
  onLoaded,
  maxSelected = 25,
}: SourcePickerLoaderProps) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [skips, setSkips] = useState<LoadedSkip[]>([]);
  const [missing, setMissing] = useState<string[]>([]);
  const [loadedCount, setLoadedCount] = useState<number | null>(null);

  const run = useCallback(async () => {
    setError(null);
    setSkips([]);
    setMissing([]);
    setLoadedCount(null);

    if (claim.trim().length < 10) {
      setError("Enter a claim of at least 10 characters before running auto-synthesis.");
      return;
    }
    if (selectedIds.length === 0) {
      setError("Select at least one cached source to synthesise.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auto-synthesis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claim: claim.trim(), source_ids: selectedIds }),
      });
      const body = (await res.json().catch(() => null)) as ApiResponse<AutoSynthesisResponse> | null;
      if (!body) {
        throw new Error("Unexpected server response.");
      }
      if (!res.ok || !body.success || !body.data) {
        throw new Error(body.error ?? "Auto-synthesis failed.");
      }

      const data = body.data;
      const rows = data.studies.map(studyRowFrom);
      const combinedSkips: LoadedSkip[] = [
        ...data.skipped.map((s) => ({ id: s.id, reason: s.reason })),
        ...data.missing_source_ids.map((id) => ({
          id,
          reason: "Not found in the source cache — ingest it first.",
        })),
      ];

      setSkips(combinedSkips);
      setMissing(data.missing_source_ids);
      setLoadedCount(rows.length);
      onLoaded(rows, combinedSkips);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to run auto-synthesis.");
    } finally {
      setLoading(false);
    }
  }, [claim, selectedIds, onLoaded]);

  return (
    <div className="mt-4 space-y-3">
      <SourceSearch onSelectionChange={setSelectedIds} maxSelected={maxSelected} />

      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={() => void run()}
          disabled={loading || selectedIds.length === 0}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {loading ? "Synthesising…" : `Run auto-synthesis (${selectedIds.length})`}
        </button>
      </div>

      {error ? (
        <p className="text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : null}

      {loadedCount !== null ? (
        <p className="text-sm text-ink/60">
          Loaded <span className="font-medium text-ink/80">{loadedCount}</span>{" "}
          study{loadedCount === 1 ? "" : "ies"} into the form
          {missing.length > 0 ? ` · ${missing.length} id(s) not in cache` : ""}.
        </p>
      ) : null}

      {skips.length > 0 ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-amber-700">
            {skips.length} source{skips.length === 1 ? "" : "s"} skipped
          </div>
          <ul className="mt-1 space-y-0.5 text-sm text-ink/60">
            {skips.map((s, i) => (
              <li key={`${s.id}-${i}`}>
                <span className="font-mono text-xs text-ink/70">{s.id}:</span> {s.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
