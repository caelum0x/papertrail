"use client";

import { ModuleHeader } from "../../claims/_components/ModuleHeader";
import { LegalHolds } from "./_components/LegalHolds";
import { DsarPanel } from "./_components/DsarPanel";

// Data-governance console: the two compliance surfaces an enterprise admin needs.
//
//  * Legal holds — preserve a data subject against retention purge during
//    litigation / regulatory obligations. An active hold is the fail-closed input
//    the retention worker consults before deleting or anonymizing any subject.
//  * DSAR — assemble, org-scoped, everything PaperTrail holds about a data subject
//    (counts + non-secret records) for a right-of-access request, downloadable as
//    a JSON package.
//
// Both surfaces are admin-only server-side (withOrg + requireRole 'admin'); this
// page renders them for org admins and surfaces honest empty/error states.

export default function DataGovernancePage() {
  return (
    <div className="space-y-6">
      <ModuleHeader
        title="Data governance"
        subtitle="Legal holds and Data Subject Access Requests — the preservation and right-of-access controls that keep PaperTrail defensible under GDPR/CCPA-style regimes."
      />

      <DsarPanel />
      <LegalHolds />
    </div>
  );
}
