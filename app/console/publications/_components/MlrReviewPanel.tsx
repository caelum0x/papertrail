import type {
  MlrDecision,
  MlrReview,
  MlrRole,
} from "@/app/api/publications/lib/types";
import { MLR_ROLES, MLR_DECISIONS, roleLabel, decisionLabel } from "./mlr";

interface MlrReviewPanelProps {
  role: MlrRole;
  decision: MlrDecision;
  comments: string;
  submitting: boolean;
  error: string | null;
  reviews: MlrReview[];
  onRoleChange: (role: MlrRole) => void;
  onDecisionChange: (decision: MlrDecision) => void;
  onCommentsChange: (value: string) => void;
  onSubmit: () => void;
}

// MLR sign-off panel: a role/decision/comment form plus the review history.
export function MlrReviewPanel({
  role,
  decision,
  comments,
  submitting,
  error,
  reviews,
  onRoleChange,
  onDecisionChange,
  onCommentsChange,
  onSubmit,
}: MlrReviewPanelProps) {
  return (
    <div className="mt-6 rounded-lg border border-ink/15 bg-white p-6">
      <h2 className="text-sm font-medium text-ink/70">MLR review</h2>
      <p className="mt-1 text-sm text-ink/40">
        Record a Medical / Legal / Regulatory sign-off decision.
      </p>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="text-xs uppercase tracking-wide text-ink/40">
            Role
          </label>
          <select
            value={role}
            onChange={(e) => onRoleChange(e.target.value as MlrRole)}
            className="mt-1 block rounded-md border border-ink/15 bg-white px-3 py-2 text-sm text-ink/80 focus:border-accent focus:outline-none"
          >
            {MLR_ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs uppercase tracking-wide text-ink/40">
            Decision
          </label>
          <select
            value={decision}
            onChange={(e) => onDecisionChange(e.target.value as MlrDecision)}
            className="mt-1 block rounded-md border border-ink/15 bg-white px-3 py-2 text-sm text-ink/80 focus:border-accent focus:outline-none"
          >
            {MLR_DECISIONS.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <textarea
        value={comments}
        onChange={(e) => onCommentsChange(e.target.value)}
        rows={2}
        placeholder="Comments (optional)"
        className="mt-3 w-full rounded-md border border-ink/15 bg-white px-3 py-2 text-sm text-ink/80 focus:border-accent focus:outline-none"
      />
      {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
      <button
        onClick={onSubmit}
        disabled={submitting}
        className="mt-3 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {submitting ? "Submitting..." : "Submit decision"}
      </button>

      {reviews.length > 0 ? (
        <ul className="mt-5 divide-y divide-ink/10 border-t border-ink/10">
          {reviews.map((r) => (
            <li key={r.id} className="py-3">
              <div className="flex items-center justify-between gap-4">
                <span className="text-sm text-ink/80">
                  {roleLabel(r.role)} — {decisionLabel(r.decision)}
                </span>
                <span className="text-xs text-ink/40">
                  {new Date(r.createdAt).toLocaleString()}
                </span>
              </div>
              {r.comments ? (
                <p className="mt-1 text-sm text-ink/60">{r.comments}</p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
