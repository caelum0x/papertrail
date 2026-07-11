"use client";

// Ranked trial match cards. Each card shows the trial header (NCT id, phase, status) with a
// deterministic eligibility verdict + score, and expands to show EVERY parsed inclusion/
// exclusion criterion with a met/not_met/unknown chip (green/red/gray) and Claude's reasoning,
// alongside the quoted criterion text. The inclusion/exclusion reasoning is shown for every
// match — nothing is hidden behind an "eligible" badge.

import { useState } from "react";
import type { CriterionAssessment } from "./types";

// A trial match as rendered here — accepts either the fresh POST shape (nctId/overallStatus)
// or a persisted row (nct_id/overall_status), normalised by the parent before passing in.
export interface MatchView {
  key: string;
  nctId: string | null;
  title: string | null;
  url: string | null;
  phase: string | null;
  overallStatus: string | null;
  eligibilityScore: number | null;
  verdict: string | null;
  criteria: CriterionAssessment[];
}

interface MatchResultsProps {
  matches: MatchView[];
}

const VERDICT_STYLE: Record<string, { label: string; cls: string }> = {
  likely_eligible: { label: "Likely eligible", cls: "bg-emerald-50 text-emerald-800" },
  possibly_eligible: { label: "Possibly eligible", cls: "bg-amber-50 text-amber-800" },
  likely_ineligible: { label: "Likely ineligible", cls: "bg-red-50 text-red-700" },
  unknown: { label: "Insufficient data", cls: "bg-ink/5 text-ink/50" },
};

const ASSESSMENT_STYLE: Record<string, { label: string; cls: string }> = {
  met: { label: "met", cls: "bg-emerald-50 text-emerald-800 border-emerald-200" },
  not_met: { label: "not met", cls: "bg-red-50 text-red-700 border-red-200" },
  unknown: { label: "unknown", cls: "bg-ink/5 text-ink/50 border-ink/15" },
};

function verdictBadge(verdict: string | null) {
  const v = VERDICT_STYLE[verdict ?? "unknown"] ?? VERDICT_STYLE.unknown;
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${v.cls}`}>{v.label}</span>
  );
}

function CriterionRow({ criterion }: { criterion: CriterionAssessment }) {
  const style = ASSESSMENT_STYLE[criterion.assessment] ?? ASSESSMENT_STYLE.unknown;
  const isUnknown = criterion.assessment === "unknown";
  return (
    <li className="border-b border-ink/10 py-2 last:border-b-0">
      <div className="flex items-start gap-2">
        <span
          className={`mt-0.5 shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium ${style.cls}`}
          title={
            isUnknown
              ? "Could not determine from the notes. Add the relevant fact (e.g. the missing lab or history) to the notes and re-run if you have it."
              : undefined
          }
        >
          {style.label}
        </span>
        <div className="min-w-0">
          <p className="text-sm text-ink/80">{criterion.text}</p>
          <p className="mt-0.5 text-xs text-ink/50">{criterion.reasoning}</p>
          {isUnknown ? (
            <p className="mt-0.5 text-xs text-ink/40">
              Could not determine from the notes — add the relevant fact and re-run to resolve
              this.
            </p>
          ) : null}
          {criterion.source_span ? (
            <p className="mt-1 border-l-2 border-ink/15 pl-2 text-xs italic text-ink/40">
              “{criterion.source_span}”
            </p>
          ) : null}
        </div>
      </div>
    </li>
  );
}

function TrialCard({ match }: { match: MatchView }) {
  const [open, setOpen] = useState(false);

  const inclusion = match.criteria.filter((c) => c.type === "inclusion");
  const exclusion = match.criteria.filter((c) => c.type === "exclusion");
  const scorePct =
    match.eligibilityScore !== null ? Math.round(match.eligibilityScore * 100) : null;

  // Surface the limit of the assessment: how many criteria the notes could not resolve. On a
  // "possibly_eligible" verdict this is the coordinator's cue to verify manually before acting.
  const unknownCount = match.criteria.filter((c) => c.assessment === "unknown").length;
  const showVerifyNote = match.verdict === "possibly_eligible" && unknownCount > 0;

  return (
    <div className="rounded-lg border border-ink/15 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="text-sm font-semibold text-ink/80">
            {match.title || match.nctId || "Untitled trial"}
          </h4>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink/40">
            {match.nctId ? (
              match.url ? (
                <a
                  href={match.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent hover:underline"
                >
                  {match.nctId}
                </a>
              ) : (
                <span>{match.nctId}</span>
              )
            ) : null}
            {match.phase ? <span>· {match.phase}</span> : null}
            {match.overallStatus ? <span>· {match.overallStatus}</span> : null}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {verdictBadge(match.verdict)}
          {scorePct !== null ? (
            <span className="text-xs text-ink/40">{scorePct}% fit</span>
          ) : null}
        </div>
      </div>

      {showVerifyNote ? (
        <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800">
          {unknownCount} criteri{unknownCount === 1 ? "on was" : "a were"} unclear from the notes —
          verify manually before acting. Add the missing facts and re-run to resolve them.
        </p>
      ) : null}

      <div className="mt-3 flex items-center justify-between">
        <span className="text-xs text-ink/40">
          {match.criteria.length} criteri{match.criteria.length === 1 ? "on" : "a"} assessed
          {unknownCount > 0 ? ` · ${unknownCount} unclear` : ""}
        </span>
        {match.criteria.length > 0 ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="text-xs font-medium text-accent hover:underline"
            aria-expanded={open}
          >
            {open ? "Hide reasoning" : "Show inclusion / exclusion reasoning"}
          </button>
        ) : null}
      </div>

      {open ? (
        <div className="mt-3 space-y-4">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-ink/40">
              Inclusion criteria ({inclusion.length})
            </div>
            {inclusion.length ? (
              <ul className="mt-1">
                {inclusion.map((c, i) => (
                  <CriterionRow key={`incl-${i}`} criterion={c} />
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-xs text-ink/40">None parsed.</p>
            )}
          </div>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-ink/40">
              Exclusion criteria ({exclusion.length})
            </div>
            {exclusion.length ? (
              <ul className="mt-1">
                {exclusion.map((c, i) => (
                  <CriterionRow key={`excl-${i}`} criterion={c} />
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-xs text-ink/40">None parsed.</p>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function MatchResults({ matches }: MatchResultsProps) {
  if (matches.length === 0) {
    return (
      <div className="rounded-lg border border-ink/15 bg-white p-6 text-sm text-ink/50">
        <p className="font-medium text-ink/70">
          No trials matched this profile on ClinicalTrials.gov.
        </p>
        <p className="mt-2 text-ink/50">The search terms may be too specific. Try:</p>
        <ul className="mt-1.5 list-disc space-y-1 pl-5 text-ink/50">
          <li>Broadening the diagnosis keyword (e.g. “breast cancer” rather than a rare subtype).</li>
          <li>
            Removing very specific biomarkers or using an alternative phrasing (e.g.
            “hormone-receptor negative” vs. “triple-negative”).
          </li>
          <li>Re-running after editing the notes above — each run searches fresh.</li>
        </ul>
        <p className="mt-3 text-ink/50">
          You can also{" "}
          <a
            href="https://clinicaltrials.gov/search"
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent hover:underline"
          >
            check ClinicalTrials.gov directly
          </a>
          .
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {matches.map((m) => (
        <TrialCard key={m.key} match={m} />
      ))}
    </div>
  );
}
