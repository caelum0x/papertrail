import type { PrismaFlowCounts } from "@/lib/prisma/schemas";

// The PRISMA flow diagram: identification → screening → inclusion, as the stacked boxes
// a reviewer expects (identified → duplicates removed → screened → excluded → included →
// extracted). Pure presentational; the counts come straight from the autopilot.

interface FlowStepProps {
  label: string;
  value: number;
  tone?: "included" | "excluded" | "default";
}

function FlowBox({ label, value, tone = "default" }: FlowStepProps) {
  const toneClass =
    tone === "included"
      ? "border-emerald-300 bg-emerald-50 text-emerald-900"
      : tone === "excluded"
        ? "border-amber-300 bg-amber-50 text-amber-900"
        : "border-ink/15 bg-white text-ink/80";
  return (
    <div className={`rounded-md border px-4 py-3 text-center ${toneClass}`}>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="mt-0.5 text-xs font-medium uppercase tracking-wide opacity-70">
        {label}
      </div>
    </div>
  );
}

function Arrow() {
  return (
    <div className="flex justify-center py-1" aria-hidden="true">
      <div className="h-4 w-px bg-ink/25" />
    </div>
  );
}

export function PrismaFlow({ counts }: { counts: PrismaFlowCounts }) {
  return (
    <div className="rounded-lg border border-ink/15 bg-white p-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-ink/50">
        PRISMA flow
      </h2>
      <div className="mx-auto mt-3 max-w-md">
        <FlowBox label="Records identified" value={counts.identified} />
        <Arrow />
        <FlowBox label="Duplicates removed" value={counts.duplicatesRemoved} />
        <Arrow />
        <FlowBox label="Screened (title/abstract)" value={counts.screened} />
        <Arrow />
        <div className="grid grid-cols-2 gap-3">
          <FlowBox label="Excluded" value={counts.excluded} tone="excluded" />
          <FlowBox label="Included" value={counts.included} tone="included" />
        </div>
        <Arrow />
        <FlowBox
          label="Included with grounded effects"
          value={counts.extractedWithEffects}
          tone="included"
        />
      </div>
    </div>
  );
}
