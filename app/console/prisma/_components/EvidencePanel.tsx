import type { PrismaAutopilotResult } from "@/lib/prisma/autopilot";

// The synthesised evidence report over the INCLUDED body of evidence. Renders the
// composite report's headline (pooled estimate, GRADE certainty, verdict) when ≥2
// studies pooled, or the honest insufficient message otherwise — the same honesty rule
// the deterministic pipeline enforces. Also lists the per-record grounded extractions.

type Report = NonNullable<PrismaAutopilotResult["report"]>;

function GradeBadge({ certainty }: { certainty: string }) {
  const cls =
    certainty === "high"
      ? "bg-emerald-100 text-emerald-800"
      : certainty === "moderate"
        ? "bg-sky-100 text-sky-800"
        : certainty === "low"
          ? "bg-amber-100 text-amber-800"
          : "bg-red-100 text-red-800";
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-semibold uppercase ${cls}`}>
      GRADE: {certainty}
    </span>
  );
}

export function EvidencePanel({
  report,
  extractedRecords,
}: {
  report: Report | null;
  extractedRecords: PrismaAutopilotResult["extractedRecords"];
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-ink/15 bg-white p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink/50">
          Synthesised evidence
        </h2>
        {!report ? (
          <p className="mt-2 text-sm text-ink/60">
            No records were included at screening, so there is no body of evidence to
            synthesise.
          </p>
        ) : report.ok ? (
          <div className="mt-2 space-y-2">
            <div className="flex items-center gap-2">
              <GradeBadge certainty={report.certainty.certainty} />
              <span className="text-xs font-medium uppercase text-ink/50">
                {report.verdict.verdict.replace(/_/g, " ")}
              </span>
            </div>
            <p className="text-sm leading-relaxed text-ink/80">{report.rationale}</p>
          </div>
        ) : (
          <div className="mt-2 space-y-1">
            <p className="text-sm text-ink/70">{report.reason}</p>
            <p className="text-xs text-ink/40">
              {report.usableStudies} usable {report.usableStudies === 1 ? "study" : "studies"}{" "}
              — an honest &ldquo;couldn&rsquo;t pool&rdquo; rather than a forced
              low-confidence answer.
            </p>
          </div>
        )}
      </div>

      {extractedRecords.length > 0 ? (
        <div className="rounded-lg border border-ink/15 bg-white p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink/50">
            Grounded extractions ({extractedRecords.length})
          </h2>
          <ul className="mt-3 divide-y divide-ink/10">
            {extractedRecords.map((r) => (
              <li key={r.id} className="flex items-center justify-between py-2">
                <span className="text-sm text-ink/80">{r.title}</span>
                <span className="text-xs tabular-nums text-ink/50">
                  {r.groundedEffectCount} grounded
                  {r.droppedEffectCount > 0 ? ` · ${r.droppedEffectCount} dropped` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
