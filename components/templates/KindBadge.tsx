import { KIND_LABELS, type TemplateKind } from "@/app/console/templates/api";

// Small colored pill indicating a template's kind. Colors are kept subtle to fit
// the paper/ink palette — accent tints rather than saturated status colors.
const KIND_CLASSES: Record<TemplateKind, string> = {
  claim: "bg-accent/10 text-accent",
  report: "bg-ink/10 text-ink/70",
  verification: "bg-emerald-500/10 text-emerald-700",
  document: "bg-amber-500/10 text-amber-700",
};

interface KindBadgeProps {
  kind: TemplateKind;
}

export function KindBadge({ kind }: KindBadgeProps) {
  return (
    <span
      className={`text-xs rounded px-2 py-0.5 ${KIND_CLASSES[kind]}`}
    >
      {KIND_LABELS[kind]}
    </span>
  );
}
