"use client";

import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { ModuleHeader } from "../_components/ModuleHeader";
import { ReportBuilder } from "../_components/ReportBuilder";
import { useActiveOrgRole, canEdit } from "../_components/useActiveOrgRole";

// Report builder page. Composes the ModuleHeader with the ReportBuilder
// (LayoutEditor + FilterEditor + PreviewPanel). An optional ?id param switches
// the builder into edit mode for an existing definition.
export default function ReportBuilderPage() {
  const role = useActiveOrgRole();
  const searchParams = useSearchParams();
  const id = searchParams.get("id") ?? undefined;

  return (
    <div>
      <ModuleHeader
        title={id ? "Edit report" : "New report"}
        description="Shape the layout, set filters, and preview the composed result."
        actions={
          <Link
            href="/console/reporting"
            className="rounded-md border border-ink/10 bg-white px-3 py-1.5 text-sm text-ink/60 hover:bg-paper"
          >
            Back to reports
          </Link>
        }
      />
      <ReportBuilder definitionId={id} canEdit={canEdit(role)} />
    </div>
  );
}
