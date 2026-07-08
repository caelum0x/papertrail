// Pretty-printed JSON panel used in the run trace for step/run input & output.

interface JsonBlockProps {
  value: unknown;
}

export function JsonBlock({ value }: JsonBlockProps) {
  if (value === null || value === undefined) {
    return <span className="text-sm text-ink/40">—</span>;
  }
  return (
    <pre className="mt-1 max-h-72 overflow-auto rounded-md border border-ink/10 bg-paper p-3 text-xs text-ink/70">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}
