// Shown when the org has no tags yet. Presentational.

export default function EmptyState() {
  return (
    <div className="rounded-lg border border-dashed border-ink/15 bg-white p-8 text-center">
      <h3 className="text-sm font-medium text-ink/80">No tags yet</h3>
      <p className="mt-1 text-sm text-ink/40">
        Create your first tag to start building a taxonomy. Tags can be nested and
        attached to any entity in the workspace.
      </p>
    </div>
  );
}
