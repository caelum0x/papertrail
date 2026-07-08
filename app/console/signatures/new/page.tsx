"use client";

import Link from "next/link";
import { ModuleHeader } from "../_components/ModuleHeader";
import { useActiveOrgRole, canManageSignatures } from "../_components/useActiveOrgRole";
import { RequestForm } from "./_components/RequestForm";

// New signature request flow: RequestForm (entity + title) with an embedded
// SignerPicker. Editors and above only; viewers are shown a gentle block.
export default function NewSignatureRequestPage() {
  const role = useActiveOrgRole();
  const canCreate = canManageSignatures(role);

  return (
    <div className="max-w-3xl">
      <Link
        href="/console/signatures"
        className="text-sm text-accent hover:underline"
      >
        ← Back to signatures
      </Link>

      <div className="mt-4">
        <ModuleHeader
          title="New signature request"
          description="Route an entity through an ordered signing ceremony."
        />
      </div>

      <div className="mt-6">
        {role === null ? (
          <div className="rounded-lg border border-ink/10 bg-white p-8 text-center text-sm text-ink/40">
            Checking your permissions…
          </div>
        ) : canCreate ? (
          <RequestForm />
        ) : (
          <div className="rounded-lg border border-dashed border-ink/10 bg-white p-8 text-center">
            <p className="text-sm font-medium text-ink/60">
              You cannot create signature requests
            </p>
            <p className="mt-1 text-xs text-ink/40">
              An editor role or higher is required.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
