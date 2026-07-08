interface CheckRowProps {
  label: string;
  passed: boolean;
}

export function CheckRow({ label, passed }: CheckRowProps) {
  return (
    <div className="flex items-center justify-between border-b border-ink/10 py-3 last:border-b-0">
      <span className="text-ink/80">{label}</span>
      {passed ? (
        <span className="font-medium text-green-600">&#10003; pass</span>
      ) : (
        <span className="font-medium text-red-600">&#10007; fail</span>
      )}
    </div>
  );
}
