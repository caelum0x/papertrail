"use client";

import { ModuleHeader } from "@/components/sso/ModuleHeader";
import { SessionsList } from "@/components/sso/SessionsList";
import { MfaSettings } from "@/components/sso/MfaSettings";

// Security settings page for the current user. Composes the active session panel
// and multi-factor authentication settings. Available to any authenticated
// member (a user manages their own security); no admin gate.

export default function SecuritySettingsPage() {
  return (
    <div className="max-w-3xl space-y-6">
      <ModuleHeader
        title="Security"
        description="Manage your two-factor authentication and review your active session."
        backHref="/console/settings"
        backLabel="Settings"
      />
      <SessionsList />
      <MfaSettings />
    </div>
  );
}
