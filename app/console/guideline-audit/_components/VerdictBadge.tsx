import type { AuditVerdict } from "@/lib/guidelineAudit/schemas";

// Per-claim verdict badge. Deterministic verdict → colour + label. Kept pure so the
// same mapping is reused in the summary bar and the table.

const STYLES: Record<AuditVerdict, { label: string; className: string }> = {
  accurate: {
    label: "Accurate",
    className: "bg-emerald-500/10 text-emerald-600 ring-emerald-500/20",
  },
  overstated: {
    label: "Overstated",
    className: "bg-red-500/10 text-red-600 ring-red-500/20",
  },
  unsupported: {
    label: "Unsupported",
    className: "bg-amber-500/10 text-amber-600 ring-amber-500/20",
  },
  uncertain: {
    label: "Uncertain",
    className: "bg-slate-500/10 text-slate-600 ring-slate-500/20",
  },
};

export function VerdictBadge({ verdict }: { verdict: AuditVerdict }) {
  const style = STYLES[verdict];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${style.className}`}
    >
      {style.label}
    </span>
  );
}
