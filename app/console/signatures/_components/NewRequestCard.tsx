"use client";

import Link from "next/link";
import { useActiveOrgRole, canManageSignatures } from "./useActiveOrgRole";

// Call-to-action card that links to the new-request flow. The action is only
// offered to editors and above; viewers see an explanatory note instead.
export function NewRequestCard() {
  const role = useActiveOrgRole();
  const canCreate = canManageSignatures(role);

  return (
    <div className="rounded-lg border border-ink/10 bg-white p-5">
      <h2 className="text-sm font-semibold text-ink">New signature request</h2>
      <p className="mt-1 text-sm text-ink/60">
        Route an entity through an ordered signing ceremony. Each signer
        re-authenticates and signs in turn; a tamper-evident certificate is
        issued once the last signer completes.
      </p>
      {canCreate ? (
        <Link
          href="/console/signatures/new"
          className="mt-4 inline-flex items-center rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
        >
          Create request
        </Link>
      ) : (
        <p className="mt-4 text-xs text-ink/40">
          You need an editor role or higher to create signature requests.
        </p>
      )}
    </div>
  );
}
