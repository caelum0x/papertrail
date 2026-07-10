"use client";

import type { GroundedClaim, ReadSource } from "./types";

// Renders the cited answer: each claim as a sentence with inline superscript
// citation markers, plus a per-claim grounding indicator. Every superscript maps
// to a source in the sources panel; every claim shown is grounded by definition
// (the engine dropped ungroundable ones), so the indicator always reads "grounded".

interface AnswerViewProps {
  claims: GroundedClaim[];
  sources: ReadSource[];
  caveat: string;
  droppedClaims: number;
}

// Superscript label for a source: its 1-based index, e.g. ¹ ² ³.
function citationLabel(sourceIndex: number): string {
  return String(sourceIndex + 1);
}

export function AnswerView({ claims, sources, caveat, droppedClaims }: AnswerViewProps) {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-ink/10 bg-white p-5">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-ink/40">
          Answer
        </p>
        <p className="mt-2 text-[15px] leading-7 text-ink/80">
          {claims.map((claim, ci) => {
            // Unique source indices this claim cites, in first-seen order.
            const cited = Array.from(
              new Set(claim.citations.map((c) => c.source_index))
            );
            return (
              <span key={ci} className="group">
                {claim.text}
                <span className="align-super text-[11px] font-semibold text-accent">
                  {cited.map((idx, k) => (
                    <a
                      key={idx}
                      href={`#src-${idx}`}
                      title={`Source ${citationLabel(idx)}`}
                      className="ml-0.5 hover:underline"
                    >
                      {citationLabel(idx)}
                      {k < cited.length - 1 ? "," : ""}
                    </a>
                  ))}
                </span>{" "}
              </span>
            );
          })}
        </p>
      </div>

      <ClaimGroundingList claims={claims} sources={sources} />

      {caveat ? (
        <div className="rounded-lg border border-amber-300/50 bg-amber-50/60 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-700/70">
            Caveat
          </p>
          <p className="mt-1 text-sm text-amber-900/80">{caveat}</p>
        </div>
      ) : null}

      {droppedClaims > 0 ? (
        <p className="text-xs text-ink/40">
          {droppedClaims} model-produced{" "}
          {droppedClaims === 1 ? "claim was" : "claims were"} dropped because the
          cited evidence could not be located verbatim in a source — only grounded
          claims are shown.
        </p>
      ) : null}
    </div>
  );
}

// Per-claim grounding indicator: shows, for each claim, the exact source spans it
// rests on. This is the trust surface — proof that each sentence is grounded.
function ClaimGroundingList({
  claims,
  sources,
}: {
  claims: GroundedClaim[];
  sources: ReadSource[];
}) {
  const titleByIndex = new Map<number, string>(
    sources.map((s) => [s.index, s.title ?? `${s.source_type}:${s.external_id}`])
  );

  return (
    <div className="rounded-lg border border-ink/10 bg-white p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink/40">
        Per-claim grounding
      </p>
      <ul className="mt-3 space-y-3">
        {claims.map((claim, ci) => (
          <li key={ci} className="text-sm">
            <div className="flex items-start gap-2">
              <span
                className="mt-0.5 shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700"
                title="Every cited span was located verbatim in the source"
              >
                grounded
              </span>
              <span className="text-ink/70">{claim.text}</span>
            </div>
            <ul className="mt-1 space-y-1 pl-8">
              {claim.citations.map((cite, k) => (
                <li key={k} className="text-xs text-ink/50">
                  <span className="font-semibold text-accent">
                    [{cite.source_index + 1}]
                  </span>{" "}
                  <span className="text-ink/40">
                    {titleByIndex.get(cite.source_index)}
                  </span>
                  <span
                    className={`ml-1 rounded px-1 text-[10px] ${
                      cite.grounding.status === "exact"
                        ? "bg-emerald-50 text-emerald-600"
                        : "bg-sky-50 text-sky-600"
                    }`}
                  >
                    {cite.grounding.status}
                  </span>
                  <blockquote className="mt-0.5 border-l-2 border-ink/15 pl-2 italic text-ink/60">
                    “{cite.quote}”
                  </blockquote>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}
