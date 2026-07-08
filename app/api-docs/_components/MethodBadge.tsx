export function MethodBadge({ method }: { method: string }) {
  const classes = method === "POST" ? "bg-accent/10 text-accent" : "bg-ink/10 text-ink/70";
  return (
    <span className={`inline-block shrink-0 rounded px-2 py-0.5 font-mono text-xs font-semibold ${classes}`}>
      {method}
    </span>
  );
}
