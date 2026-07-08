interface StatTileProps {
  value: number | string;
  label: string;
  emphasis?: "default" | "green" | "amber" | "red";
}

const EMPHASIS: Record<NonNullable<StatTileProps["emphasis"]>, string> = {
  default: "text-ink/80",
  green: "text-green-700",
  amber: "text-amber-700",
  red: "text-red-700",
};

// Small metric tile used on the monitoring overview and activity sub-pages.
export function StatTile({ value, label, emphasis = "default" }: StatTileProps) {
  return (
    <div className="bg-white border border-ink/15 rounded-lg p-4">
      <div className={`text-2xl font-semibold ${EMPHASIS[emphasis]}`}>
        {value}
      </div>
      <div className="mt-1 text-xs uppercase tracking-wide text-ink/40">
        {label}
      </div>
    </div>
  );
}
