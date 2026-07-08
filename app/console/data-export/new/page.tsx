"use client";

import Link from "next/link";
import { useRole } from "../_components/useRole";
import { ModuleHeader } from "../_components/ModuleHeader";
import { ExportWizard } from "../_components/ExportWizard";

// Guided export creation page. Composes the ExportWizard (ScopeStep + FormatStep
// + ConfirmStep). Gating to editor+ is enforced server-side and reflected here.
export default function NewExportPage() {
  const { canEdit, loading } = useRole();

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/console/data-export"
          className="text-sm text-accent hover:underline"
        >
          ← Data export center
        </Link>
      </div>

      <ModuleHeader
        title="New export"
        description="Choose a data scope and format, then start the export."
      />

      {loading ? (
        <div className="rounded-lg border border-ink/15 bg-white p-8 text-center text-sm text-ink/40">
          Loading…
        </div>
      ) : (
        <ExportWizard canEdit={canEdit} />
      )}
    </div>
  );
}
