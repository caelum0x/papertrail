import Link from "next/link";
import { SecurityCenterHeader } from "@/components/security/SecurityCenterHeader";
import { SecurityOverview } from "@/components/security/SecurityOverview";
import { PolicyCards } from "@/components/security/PolicyCards";

// Security Center landing page. Server component that composes the header and
// the two client panels (overview + policy cards), each of which owns its own
// data fetching and loading/empty/error states.

export const metadata = {
  title: "Security Center",
};

export default function SecurityCenterPage() {
  return (
    <div className="max-w-4xl space-y-8">
      <SecurityCenterHeader
        crumbs={[
          { label: "Settings", href: "/console/settings" },
          { label: "Security Center" },
        ]}
        title="Security Center"
        subtitle="Review tenant isolation, manage security controls, and restrict access to your organization's data."
        action={
          <div className="flex gap-3 text-sm">
            <Link
              href="/console/settings/security-center/policies"
              className="text-accent hover:underline"
            >
              Policies
            </Link>
            <Link
              href="/console/settings/security-center/access"
              className="text-accent hover:underline"
            >
              Access control
            </Link>
          </div>
        }
      />

      <SecurityOverview />
      <PolicyCards />
    </div>
  );
}
