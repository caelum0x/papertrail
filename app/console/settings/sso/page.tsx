"use client";

import { AdminGate } from "@/components/sso/AdminGate";
import { ModuleHeader } from "@/components/sso/ModuleHeader";
import { SsoConnectionList } from "@/components/sso/SsoConnectionList";
import { AddConnectionCard } from "@/components/sso/AddConnectionCard";

// SSO settings home. Composes the module header, the org's connections list, and
// a card to add a new connection. Admin+ only (gated client-side for UX and by
// the API server-side).

export default function SsoSettingsPage() {
  return (
    <AdminGate title="SSO connections">
      <div className="max-w-3xl space-y-6">
        <ModuleHeader
          title="Single sign-on"
          description="Let your team sign in through your identity provider (SAML 2.0 or OpenID Connect), and automate provisioning with SCIM."
          backHref="/console/settings"
          backLabel="Settings"
        />
        <SsoConnectionList />
        <AddConnectionCard />
      </div>
    </AdminGate>
  );
}
