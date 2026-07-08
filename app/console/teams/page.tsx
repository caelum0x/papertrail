import { ModuleHeader } from "@/components/rbac/ModuleHeader";
import { TeamsGrid } from "@/components/rbac/TeamsGrid";

// LIST view: grid of teams with an inline create card.
export default function TeamsPage() {
  return (
    <div className="max-w-5xl">
      <ModuleHeader
        title="Teams"
        subtitle="Group organization members into teams for shared collaboration."
      />
      <TeamsGrid />
    </div>
  );
}
