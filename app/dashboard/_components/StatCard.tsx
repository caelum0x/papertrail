interface StatCardProps {
  label: string;
  value: string;
}

export function StatCard({ label, value }: StatCardProps) {
  return (
    <div className="rounded-lg border border-ink/10 bg-white p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-ink/40">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-ink/90">{value}</div>
    </div>
  );
}
