// Destructive-action card for permanently deleting a project.

interface DangerZoneProps {
  deleting: boolean;
  onDelete: () => void;
}

export function DangerZone({ deleting, onDelete }: DangerZoneProps) {
  return (
    <div className="mt-6 bg-white border border-red-200 rounded-lg p-5">
      <h2 className="text-sm font-medium text-red-600">Danger zone</h2>
      <p className="mt-1 text-sm text-ink/40">
        Deleting a project removes it and its member assignments permanently.
      </p>
      <button
        onClick={onDelete}
        disabled={deleting}
        className="mt-3 text-sm border border-red-300 text-red-600 rounded px-3 py-2 hover:bg-red-50 disabled:opacity-50"
      >
        {deleting ? "Deleting..." : "Delete project"}
      </button>
    </div>
  );
}
