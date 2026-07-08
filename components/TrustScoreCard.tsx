import { trustBand, trustBandClasses, trustBandLabel } from "@/lib/trustBand";

const LABELS: Record<string, string> = {
  accurate: "Accurate",
  magnitude_overstated: "Magnitude overstated",
  population_overgeneralized: "Population overgeneralized",
  caveat_dropped: "Caveat dropped",
  no_support_found: "No support found",
};

type CrossSourceAgreement = "single_source" | "corroborated" | "conflicting";

const AGREEMENT: Record<CrossSourceAgreement, { label: string; classes: string }> = {
  corroborated: {
    label: "Corroborated by multiple independent sources",
    classes: "border-green-300 bg-green-50 text-green-800",
  },
  single_source: {
    label: "Based on a single source — no corroborating studies found",
    classes: "border-ink/15 bg-ink/5 text-ink/60",
  },
  conflicting: {
    label: "Sources disagree with each other",
    classes: "border-amber-300 bg-amber-50 text-amber-900",
  },
};

export function TrustScoreCard(props: {
  trustScore: number;
  discrepancyType: string;
  explanation: string;
  crossSourceAgreement?: CrossSourceAgreement;
}) {
  const band = trustBand(props.trustScore);
  const agreement = props.crossSourceAgreement ? AGREEMENT[props.crossSourceAgreement] : null;
  return (
    <div className={`rounded-lg border p-4 ${trustBandClasses(band)}`}>
      <div className="flex items-baseline justify-between">
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-semibold">{props.trustScore}</span>
          <span className="text-xs uppercase tracking-wide opacity-70">{trustBandLabel(band)}</span>
        </div>
        <span className="text-sm font-medium">
          {LABELS[props.discrepancyType] ?? props.discrepancyType}
        </span>
      </div>
      <p className="mt-2 text-sm">{props.explanation}</p>
      {agreement && (
        <div className={`mt-3 rounded-md border px-2.5 py-1.5 text-xs font-medium ${agreement.classes}`}>
          {agreement.label}
        </div>
      )}
    </div>
  );
}
