import { CLAIM_STATUSES } from "@/lib/claims/schemas";

// Status selector + delete action for a claim, with an inline error line.

interface ClaimActionsProps {
  status: string;
  savingStatus: boolean;
  deleting: boolean;
  actionError: string | null;
  onChangeStatus: (status: string) => void;
  onDelete: () => void;
}

export function ClaimActions({
  status,
  savingStatus,
  deleting,
  actionError,
  onChangeStatus,
  onDelete,
}: ClaimActionsProps) {
  return (
    <div className="mt-6 rounded-lg border border-ink/15 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <label htmlFor="status-select" className="text-sm text-ink/60">
            Status
          </label>
          <select
            id="status-select"
            value={status}
            disabled={savingStatus}
            onChange={(e) => onChangeStatus(e.target.value)}
            className="rounded-md border border-ink/15 bg-white px-2 py-1 text-sm text-ink/80 focus:border-accent focus:outline-none disabled:opacity-50"
          >
            {CLAIM_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </option>
            ))}
          </select>
        </div>
        <button
          onClick={onDelete}
          disabled={deleting}
          className="text-sm font-medium text-red-700 hover:underline disabled:opacity-50"
        >
          {deleting ? "Deleting..." : "Delete claim"}
        </button>
      </div>
      {actionError ? (
        <p className="mt-2 text-sm text-red-700">{actionError}</p>
      ) : null}
    </div>
  );
}
