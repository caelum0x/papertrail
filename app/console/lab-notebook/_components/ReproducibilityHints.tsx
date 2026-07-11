import type { ReproducibilityReport } from "@/lib/labNotebook/reproducibility";

// Renders the deterministic reproducibility check (lib/labNotebook/reproducibility.ts):
// amber "add for reproducibility" hints computed from the already-structured fields — no
// LLM call, no invented data. Each hint only points out a MISSING detail (a missing
// dilution, vendor/cat#, control, or sample size), so this panel never asserts a value the
// scientist didn't write. Shown in both the pre-save preview and the saved detail view.

const SECTION_LABEL: Record<
  ReproducibilityReport["hints"][number]["section"],
  string
> = {
  reagents: "Reagents",
  samples: "Samples",
  protocol: "Protocol",
  observations: "Observations",
};

interface ReproducibilityHintsProps {
  report: ReproducibilityReport;
}

export function ReproducibilityHints({ report }: ReproducibilityHintsProps) {
  if (report.clean) {
    return (
      <section
        className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2"
        aria-label="Reproducibility check"
      >
        <div className="flex items-center gap-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
            Reproducibility check
          </h4>
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-700">
            No gaps found
          </span>
        </div>
        <p className="mt-1 text-xs text-emerald-800/90">
          The record carries the reagent sources, controls and sample-size details another
          lab would need to reproduce it. This is a deterministic check on your structured
          fields — no AI call, nothing invented.
        </p>
      </section>
    );
  }

  return (
    <section
      className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2"
      aria-label="Reproducibility check"
    >
      <div className="flex items-center gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-amber-800">
          Add for reproducibility
        </h4>
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-800">
          {report.hints.length} hint{report.hints.length === 1 ? "" : "s"}
        </span>
      </div>
      <p className="mt-1 text-xs text-amber-800/90">
        A deterministic check on your structured record flagged details another lab would
        need to reproduce it. These are hints, not errors — and nothing is invented, each
        one just points out a value that appears to be missing.
      </p>
      <ul className="mt-2 space-y-2">
        {report.hints.map((hint) => (
          <li
            key={hint.id}
            className="rounded-md border border-amber-200/70 bg-white/60 px-2.5 py-2"
          >
            <div className="flex items-start gap-2">
              <span
                className="mt-0.5 shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-800"
                title={`Reproducibility hint for the ${SECTION_LABEL[hint.section]} section`}
              >
                {SECTION_LABEL[hint.section]}
              </span>
              <div className="min-w-0">
                <p className="text-xs font-medium text-amber-900">{hint.message}</p>
                <p className="mt-0.5 text-xs text-amber-800/80">{hint.detail}</p>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
