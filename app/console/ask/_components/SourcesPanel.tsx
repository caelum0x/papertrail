"use client";

import type { ReadSource } from "./types";

// The sources panel: one card per read paper, anchored so answer superscripts
// (#src-<index>) link straight to it. Each card lists the verbatim evidence
// snippets Claude extracted and that were grounded to the source text.

interface SourcesPanelProps {
  sources: ReadSource[];
}

const SUPPORT_STYLE: Record<string, string> = {
  answers: "bg-emerald-50 text-emerald-700",
  contradicts: "bg-rose-50 text-rose-700",
  context: "bg-slate-50 text-slate-600",
};

export function SourcesPanel({ sources }: SourcesPanelProps) {
  const withEvidence = sources.filter((s) => s.evidence.length > 0);
  if (withEvidence.length === 0) return null;

  return (
    <div className="space-y-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink/40">
        Sources read ({withEvidence.length})
      </p>
      {withEvidence.map((source) => (
        <div
          key={source.id}
          id={`src-${source.index}`}
          className="scroll-mt-24 rounded-lg border border-ink/10 bg-white p-4"
        >
          <div className="flex items-baseline justify-between gap-3">
            <div className="flex items-baseline gap-2">
              <span className="shrink-0 rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-semibold text-accent">
                {source.index + 1}
              </span>
              <a
                href={source.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-medium text-ink/80 hover:underline"
              >
                {source.title ?? `${source.source_type}:${source.external_id}`}
              </a>
            </div>
            <span className="shrink-0 text-[11px] text-ink/40">
              {(source.similarity * 100).toFixed(0)}% match
            </span>
          </div>
          <p className="mt-1 text-[11px] uppercase tracking-wide text-ink/30">
            {source.source_type} · {source.external_id}
          </p>

          <ul className="mt-3 space-y-2">
            {source.evidence.map((ev, i) => (
              <li key={i} className="text-xs">
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                    SUPPORT_STYLE[ev.supports] ?? SUPPORT_STYLE.context
                  }`}
                >
                  {ev.supports}
                </span>
                <blockquote className="mt-1 border-l-2 border-accent/30 pl-2 italic text-ink/70">
                  “{ev.located_text}”
                </blockquote>
                <p className="mt-0.5 text-ink/40">{ev.relevance}</p>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
