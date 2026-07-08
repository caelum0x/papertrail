import type { PrismaCounts } from "@/app/api/sr-projects/lib/types";

function FlowBox({
  title,
  count,
  tone = "default",
}: {
  title: string;
  count: number;
  tone?: "default" | "included";
}) {
  return (
    <div
      className={`rounded-lg border p-4 text-center ${
        tone === "included"
          ? "border-accent/40 bg-paper"
          : "border-ink/15 bg-white"
      }`}
    >
      <div className="text-2xl font-semibold text-ink/80">{count}</div>
      <div className="mt-1 text-xs uppercase tracking-wide text-ink/40">
        {title}
      </div>
    </div>
  );
}

function Arrow() {
  return <div className="my-1 text-center text-ink/30">↓</div>;
}

function ExcludedBox({ title, count }: { title: string; count: number }) {
  return (
    <div className="rounded-lg border border-ink/10 bg-paper p-3 text-sm">
      <span className="font-medium text-ink/70">{count}</span>{" "}
      <span className="text-ink/60">{title}</span>
    </div>
  );
}

// The full PRISMA flow diagram plus the full-text exclusion-reason breakdown.

export function PrismaDiagram({ counts }: { counts: PrismaCounts }) {
  return (
    <div className="mt-6 space-y-1">
      <FlowBox title="Records identified" count={counts.identified} />
      {counts.duplicatesRemoved > 0 ? (
        <div className="flex justify-end">
          <ExcludedBox
            title="duplicates removed"
            count={counts.duplicatesRemoved}
          />
        </div>
      ) : null}
      <Arrow />
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
        <FlowBox
          title="Title / abstract screened"
          count={counts.titleScreened}
        />
        <div className="flex items-center">
          <ExcludedBox
            title="excluded at title/abstract"
            count={counts.titleExcluded}
          />
        </div>
      </div>
      <Arrow />
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
        <FlowBox title="Full-text assessed" count={counts.fullTextAssessed} />
        <div className="flex items-center">
          <ExcludedBox
            title="excluded at full text"
            count={counts.fullTextExcluded}
          />
        </div>
      </div>
      <Arrow />
      <FlowBox
        title="Included in review"
        count={counts.included}
        tone="included"
      />

      {counts.fullTextExclusionReasons.length > 0 ? (
        <div className="mt-6 rounded-lg border border-ink/15 bg-white p-4">
          <div className="text-xs uppercase tracking-wide text-ink/40">
            Full-text exclusion reasons
          </div>
          <ul className="mt-2 space-y-1 text-sm text-ink/80">
            {counts.fullTextExclusionReasons.map((r, i) => (
              <li key={i} className="flex justify-between gap-4">
                <span className="min-w-0 truncate">{r.reason}</span>
                <span className="shrink-0 text-ink/60">{r.count}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
