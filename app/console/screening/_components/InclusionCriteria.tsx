// Read-only list of a review's inclusion criteria.

interface InclusionCriteriaProps {
  criteria: string[];
}

export function InclusionCriteria({ criteria }: InclusionCriteriaProps) {
  if (criteria.length === 0) return null;
  return (
    <div className="mt-4 rounded-md border border-ink/10 bg-paper p-4">
      <div className="text-xs uppercase tracking-wide text-ink/40">
        Inclusion criteria
      </div>
      <ul className="mt-1 list-inside list-disc text-sm text-ink/80">
        {criteria.map((c, i) => (
          <li key={i}>{c}</li>
        ))}
      </ul>
    </div>
  );
}
