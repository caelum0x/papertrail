import type { DeepResearchResponse } from "./types";
import { ClaimList } from "./ClaimList";

// Stage 3 — the synthesised cited report. A cited summary, one section per
// sub-question, and honest limitations. Every claim shown here survived grounding
// against a real source span; ungroundable claims were dropped upstream.

interface ReportViewProps {
  report: DeepResearchResponse;
}

export function ReportView({ report }: ReportViewProps) {
  const nothingGrounded =
    report.summary.length === 0 && report.sections.every((s) => s.claims.length === 0);

  return (
    <section className="rounded-lg border border-ink/10 bg-white p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink/50">
          Synthesised report
        </h2>
        {report.dropped_claims > 0 ? (
          <span className="text-[11px] text-ink/35">
            {report.dropped_claims} ungrounded claim{report.dropped_claims === 1 ? "" : "s"} dropped
          </span>
        ) : null}
      </div>

      {nothingGrounded ? (
        <p className="mt-3 text-sm text-ink/50">
          No synthesis claim could be grounded to an exact source span. The verified
          per-sub-question evidence above is the honest result.
        </p>
      ) : (
        <div className="mt-4 space-y-6">
          {report.summary.length > 0 ? (
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink/40">
                Summary
              </h3>
              <ClaimList claims={report.summary} sources={report.sources} />
            </div>
          ) : null}

          {report.sections.map((section, i) => (
            <div key={i}>
              <h3 className="mb-2 text-sm font-medium text-ink/70">{section.sub_question}</h3>
              <ClaimList claims={section.claims} sources={report.sources} />
            </div>
          ))}
        </div>
      )}

      {report.limitations ? (
        <div className="mt-6 rounded-lg border border-ink/10 bg-white p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink/40">
            Limitations
          </p>
          <p className="mt-1 text-xs leading-relaxed text-ink/60">{report.limitations}</p>
        </div>
      ) : null}
    </section>
  );
}
