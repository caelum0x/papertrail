interface MetricCard {
  key: string;
  label: string;
  value: number | null;
}

interface MetricCardsProps {
  cards: MetricCard[];
  loading: boolean;
}

// Grid of headline metric cards. A null value or loading state renders a dash
// placeholder.
export function MetricCards({ cards, loading }: MetricCardsProps) {
  return (
    <div className="mt-6 grid grid-cols-2 sm:grid-cols-3 gap-4">
      {cards.map((card) => (
        <div
          key={card.key}
          className="bg-white border border-ink/10 rounded-lg p-4"
        >
          <div className="text-xs text-ink/40">{card.label}</div>
          <div className="mt-1 text-2xl font-semibold text-ink/80 tabular-nums">
            {loading || card.value === null ? (
              <span className="text-ink/30">—</span>
            ) : (
              card.value.toLocaleString()
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
