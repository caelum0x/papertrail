import type { GuidelineAuditSummary } from "@/lib/guidelineAudit/schemas";

// Headline summary bar for an audit run: how many claims were extracted and how they
// broke down. The overstated count is the money number — it's what a translational
// researcher scanning a press release wants to see first.

const CARDS: {
  key: keyof GuidelineAuditSummary;
  label: string;
  tone: string;
}[] = [
  { key: "total", label: "Efficacy claims", tone: "text-ink/80" },
  { key: "accurate", label: "Accurate", tone: "text-emerald-600" },
  { key: "overstated", label: "Overstated", tone: "text-red-600" },
  { key: "unsupported", label: "Unsupported", tone: "text-amber-600" },
];

export function AuditSummary({ summary }: { summary: GuidelineAuditSummary }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {CARDS.map((card) => (
        <div
          key={card.key}
          className="rounded-lg border border-ink/10 bg-white/40 px-4 py-3"
        >
          <p className={`text-2xl font-semibold ${card.tone}`}>
            {summary[card.key]}
          </p>
          <p className="mt-0.5 text-xs text-ink/40">{card.label}</p>
        </div>
      ))}
    </div>
  );
}
