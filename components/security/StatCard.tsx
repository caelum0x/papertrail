// A small labelled metric card used in the security overview summary row.

interface StatCardProps {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "good" | "warn";
}

const TONE_CLASS: Record<NonNullable<StatCardProps["tone"]>, string> = {
  default: "text-ink/80",
  good: "text-emerald-600",
  warn: "text-amber-600",
};

export function StatCard({ label, value, hint, tone = "default" }: StatCardProps) {
  return (
    <div className="bg-white border border-ink/15 rounded-lg p-4">
      <p className="text-xs uppercase tracking-wide text-ink/40">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${TONE_CLASS[tone]}`}>
        {value}
      </p>
      {hint ? <p className="mt-1 text-xs text-ink/40">{hint}</p> : null}
    </div>
  );
}
