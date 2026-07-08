import { SecurityCenterHeader } from "@/components/security/SecurityCenterHeader";
import { DataResidencyPanel } from "@/components/security/DataResidencyPanel";
import { AccessControlPanel } from "./AccessControlPanel";

// Access control page. Server component composing the header, the IP allowlist
// management panel (form + table), and the data residency side panel in a
// two-column layout on wide screens.

export const metadata = {
  title: "Access control",
};

export default function AccessControlPage() {
  return (
    <div className="max-w-4xl space-y-6">
      <SecurityCenterHeader
        crumbs={[
          { label: "Settings", href: "/console/settings" },
          {
            label: "Security Center",
            href: "/console/settings/security-center",
          },
          { label: "Access control" },
        ]}
        title="Access control"
        subtitle="Restrict which networks can reach your organization's data and review where that data lives."
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <AccessControlPanel />
        </div>
        <aside className="lg:col-span-1">
          <DataResidencyPanel />
        </aside>
      </div>
    </div>
  );
}
