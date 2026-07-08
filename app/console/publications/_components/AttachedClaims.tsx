import type { PublicationClaim } from "@/app/api/publications/lib/types";
import { TableCard, TableLoading, TableError } from "./TableCard";

function claimStateLabel(claim: PublicationClaim): {
  label: string;
  className: string;
} {
  if (claim.discrepancyType === "accurate" && claim.claimStatus === "verified") {
    return { label: "Verified · accurate", className: "text-green-700" };
  }
  if (
    claim.claimStatus === "flagged" ||
    (claim.discrepancyType && claim.discrepancyType !== "accurate")
  ) {
    return {
      label: `Flagged${claim.discrepancyType ? ` · ${claim.discrepancyType}` : ""}`,
      className: "text-red-700",
    };
  }
  if (claim.claimStatus === "verified") {
    return { label: "Verified", className: "text-ink/60" };
  }
  return { label: "Unverified", className: "text-ink/40" };
}

interface AttachedClaimsProps {
  claims: PublicationClaim[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}

// List of attached claims joined with their verification state.
export function AttachedClaims({
  claims,
  loading,
  error,
  onRetry,
}: AttachedClaimsProps) {
  return (
    <div className="mt-6">
      <h2 className="text-sm font-medium text-ink/70">Attached claims</h2>
      <div className="mt-3">
        <TableCard>
          {loading ? (
            <TableLoading>Loading claims...</TableLoading>
          ) : error ? (
            <TableError message={error} onRetry={onRetry} />
          ) : claims.length === 0 ? (
            <TableLoading>
              No claims attached yet. Attach verified claims above.
            </TableLoading>
          ) : (
            <ul className="divide-y divide-ink/10">
              {claims.map((c) => (
                <ClaimRow key={c.id} claim={c} />
              ))}
            </ul>
          )}
        </TableCard>
      </div>
    </div>
  );
}

function ClaimRow({ claim: c }: { claim: PublicationClaim }) {
  const state = claimStateLabel(c);
  return (
    <li className="p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm text-ink/80">
            {c.claimText ?? (
              <span className="text-ink/40">(claim unavailable)</span>
            )}
          </p>
          <p className="mt-1 text-xs text-ink/40">
            {c.status}
            {c.trustScore != null ? ` · trust ${c.trustScore}` : ""}
          </p>
        </div>
        <span className={`shrink-0 text-xs font-medium ${state.className}`}>
          {state.label}
        </span>
      </div>
    </li>
  );
}
