// Header for the tag taxonomy surface. Presentational; the parent owns state.

interface ModuleHeaderProps {
  total: number;
}

export default function ModuleHeader({ total }: ModuleHeaderProps) {
  return (
    <div>
      <h1 className="text-2xl font-semibold text-ink/80">Tags &amp; taxonomy</h1>
      <p className="mt-1 text-sm text-ink/60">
        A shared vocabulary you can attach to claims, references, documents, and
        more. Organize tags into a hierarchy and reuse them across the workspace.
      </p>
      <p className="mt-2 text-xs text-ink/40">
        {total} {total === 1 ? "tag" : "tags"} in this organization
      </p>
    </div>
  );
}
