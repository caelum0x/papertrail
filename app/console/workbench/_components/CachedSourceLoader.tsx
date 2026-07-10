"use client";

import { useCallback, useState } from "react";
import type { ApiResponse } from "@/lib/api/response";
import type { RatioMeasure, StudyForm } from "./types";

// "Load from cached sources" mode for the Evidence Workbench. The reviewer pastes a
// comma-separated list of cached source ids (UUIDs from the `sources` table); this
// POSTs the claim + ids to /api/auto-synthesis, which DETERMINISTICALLY extracts one
// poolable ratio effect per source and returns the pooled evidence report. We lift the
// extracted studies back into the workbench's study rows (so the deterministic stack
// renders exactly as in manual mode) and surface which sources were skipped and why.
// NO LLM is in this path — every extracted number traces to the cached source data.

// The auto-synthesis wire shapes we consume. Kept minimal/structural: only the fields
// this loader reads, so it doesn't couple to the full lib/autoSynthesis types.
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

export interface LoadedSkip {
  id: string;
  reason: string;
}

interface CachedSourceLoaderProps {
  claim: string;
  // Called with the extracted study rows once the sources synthesise successfully.
  onLoaded: (rows: StudyForm[], skips: LoadedSkip[]) => void;
}

let loadedSeq = 0;
function studyRowFrom(study: ExtractedStudyWire): StudyForm {
  loadedSeq += 1;
  return {
    id: `loaded-${loadedSeq}`,
    label: study.label,
    measure: study.measure,
    point: String(study.point),
    ciLower: String(study.ci_lower),
    ciUpper: String(study.ci_upper),
  };
}

// Split the free-text id field into a clean, de-duplicated id list. Accepts commas,
// whitespace or newlines as separators so pasted lists "just work".
function parseIds(raw: string): string[] {
  const parts = raw
    .split(/[\s,]+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  return Array.from(new Set(parts));
}

export function CachedSourceLoader({ claim, onLoaded }: CachedSourceLoaderProps) {
  const [idsRaw, setIdsRaw] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [skips, setSkips] = useState<LoadedSkip[]>([]);
  const [missing, setMissing] = useState<string[]>([]);
  const [loadedCount, setLoadedCount] = useState<number | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setSkips([]);
    setMissing([]);
    setLoadedCount(null);

    if (claim.trim().length < 10) {
      setError("Enter a claim of at least 10 characters before loading sources.");
      return;
    }
    const ids = parseIds(idsRaw);
    if (ids.length === 0) {
      setError("Paste at least one cached source id (comma or space separated).");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auto-synthesis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claim: claim.trim(), source_ids: ids }),
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
      setError(err instanceof Error ? err.message : "Failed to load cached sources.");
    } finally {
      setLoading(false);
    }
  }, [claim, idsRaw, onLoaded]);

  return (
    <div className="mt-4 space-y-3">
      <div>
        <label className="block text-xs font-medium uppercase tracking-wide text-ink/40" htmlFor="source-ids">
          Cached source ids
        </label>
        <textarea
          id="source-ids"
          rows={2}
          value={idsRaw}
          onChange={(e) => setIdsRaw(e.target.value)}
          placeholder="Paste comma-separated source ids, e.g. 3f1c…, 9a2b…"
          className="mt-1 w-full rounded-md border border-ink/15 bg-white px-3 py-2 font-mono text-xs text-ink focus:border-accent focus:outline-none"
        />
        <p className="mt-1 text-xs text-ink/40">
          UUIDs from the cached <code>sources</code> table (PubMed or ClinicalTrials.gov).
          Each source&apos;s primary ratio effect is extracted deterministically and pooled.
        </p>
      </div>

      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {loading ? "Loading…" : "Load studies from sources"}
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
