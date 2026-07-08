import { SecurityCenterHeader } from "@/components/security/SecurityCenterHeader";
import { PolicyEditor } from "@/components/security/PolicyEditor";

// Policy editor page. Server component composing the header and the client
// PolicyEditor, which lists every security control with inline enable toggles
// and per-control config forms.

export const metadata = {
  title: "Security policies",
};

export default function SecurityPoliciesPage() {
  return (
    <div className="max-w-3xl space-y-6">
      <SecurityCenterHeader
        crumbs={[
          { label: "Settings", href: "/console/settings" },
          {
            label: "Security Center",
            href: "/console/settings/security-center",
          },
          { label: "Policies" },
        ]}
        title="Security policies"
        subtitle="Enable and configure the security controls that apply to every member of this organization."
      />
      <PolicyEditor />
    </div>
  );
}
