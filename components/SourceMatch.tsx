import { ReactNode } from "react";

interface SourceMatchProps {
  source: {
    title: string | null;
    url: string;
    source_type: string;
    excerpt?: string;
    // Trial context (ClinicalTrials.gov only). Rendered as small badges when present.
    phase?: string | null;
    enrollment_count?: number | null;
  };
  /** Rendered below the source header — typically the highlighted passage. */
  children?: ReactNode;
}

export function SourceMatch({ source, children }: SourceMatchProps) {
  const hasPhase = Boolean(source.phase);
  const hasEnrollment = typeof source.enrollment_count === "number";
  return (
    <div className="rounded-lg border border-ink/10 bg-white p-4">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-ink/40">
          Matched source · {source.source_type === "pubmed" ? "PubMed" : "ClinicalTrials.gov"}
        </span>
        {hasPhase && (
          <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
            {source.phase}
          </span>
        )}
        {hasEnrollment && (
          <span className="rounded bg-ink/10 px-1.5 py-0.5 text-[10px] font-semibold text-ink/60">
            n={source.enrollment_count!.toLocaleString()}
          </span>
        )}
      </div>
      <a
        href={source.url}
        target="_blank"
        rel="noreferrer"
        className="font-medium text-accent hover:underline"
      >
        {source.title || source.url}
      </a>
      {source.excerpt && <p className="mt-2 text-sm text-ink/70">{source.excerpt}...</p>}
      {children && <div className="mt-3">{children}</div>}
    </div>
  );
}
