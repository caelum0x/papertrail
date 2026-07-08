import { ModuleHeader } from "@/components/flags/ModuleHeader";
import { FlagList } from "@/components/flags/FlagList";

// Feature-flags list page: a thin server component that composes the shared
// module header with the stateful flag list (search + create + pagination).
export default function FeatureFlagsPage() {
  return (
    <div className="space-y-6">
      <ModuleHeader
        title="Feature flags"
        description="Toggle features on or off, roll out gradually by percentage, and target subjects with rules."
      />
      <FlagList />
    </div>
  );
}
