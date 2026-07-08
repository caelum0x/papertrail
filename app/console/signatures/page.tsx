import { ModuleHeader } from "./_components/ModuleHeader";
import { RequestsList } from "./_components/RequestsList";
import { NewRequestCard } from "./_components/NewRequestCard";

// Signatures console home: the org's signature requests plus a CTA to start a
// new one. E-signature ceremonies are distinct from the compliance audit
// hash-chain — this is an explicit, ordered "please sign this" workflow.
export default function SignaturesPage() {
  return (
    <div>
      <ModuleHeader
        title="Signatures"
        description="Ordered e-signature requests over claims, reports, and other entities."
      />

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <RequestsList />
        </div>
        <div>
          <NewRequestCard />
        </div>
      </div>
    </div>
  );
}
