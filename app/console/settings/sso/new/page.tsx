"use client";

import { AdminGate } from "@/components/sso/AdminGate";
import { ModuleHeader } from "@/components/sso/ModuleHeader";
import { ConnectionForm } from "@/components/sso/ConnectionForm";

// New SSO connection wizard page. Composes the module header + the multi-step
// ConnectionForm. Admin+ only.

export default function NewSsoConnectionPage() {
  return (
    <AdminGate title="SSO connections">
      <div className="max-w-3xl space-y-6">
        <ModuleHeader
          title="Add SSO connection"
          description="Choose a protocol, name the connection, and enter your identity provider's configuration. You'll verify domain ownership on the next screen."
          backHref="/console/settings/sso"
          backLabel="SSO connections"
        />
        <ConnectionForm />
      </div>
    </AdminGate>
  );
}
