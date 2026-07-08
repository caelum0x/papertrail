interface CodeBlockProps {
  children: string;
  label?: string;
}

export function CodeBlock({ children, label }: CodeBlockProps) {
  return (
    <div className="mt-3">
      {label && <p className="mb-1 text-xs font-medium uppercase tracking-wide text-ink/40">{label}</p>}
      <pre className="overflow-x-auto rounded-lg border border-ink/10 bg-ink/5 p-4 text-xs leading-relaxed text-ink/80">
        <code>{children}</code>
      </pre>
    </div>
  );
}
