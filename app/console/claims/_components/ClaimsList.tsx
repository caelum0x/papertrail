import Link from "next/link";
import type { ClaimDto } from "@/components/claims/api";
import { StatusBadge } from "@/components/claims/StatusBadge";

// List of claim rows. Each row links to the claim detail page.

function ClaimRow({ claim }: { claim: ClaimDto }) {
  return (
    <li>
      <Link
        href={`/console/claims/${claim.id}`}
        className="flex items-start justify-between gap-4 px-5 py-4 hover:bg-paper"
      >
        <div className="min-w-0">
          <p className="truncate text-sm text-ink/80">{claim.text}</p>
          <p className="mt-1 text-xs text-ink/40">
            {new Date(claim.created_at).toLocaleDateString()}
          </p>
        </div>
        <StatusBadge status={claim.status} />
      </Link>
    </li>
  );
}

export function ClaimsList({ claims }: { claims: ClaimDto[] }) {
  return (
    <ul className="divide-y divide-ink/10">
      {claims.map((claim) => (
        <ClaimRow key={claim.id} claim={claim} />
      ))}
    </ul>
  );
}
