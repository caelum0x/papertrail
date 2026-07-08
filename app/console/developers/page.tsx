"use client";

import { DevelopersHeader } from "./_components/DevelopersHeader";
import { PortalLinks } from "./_components/PortalLinks";
import { ApiKeysManager } from "./_components/ApiKeysManager";
import { useApiKeys } from "./_components/useApiKeys";

// Developer portal landing page. Reuses the org's API keys (create / revoke)
// exactly like the admin API-keys page, plus links to the webhooks manager and
// the interactive API reference.
export default function DevelopersPage() {
  const {
    canManage,
    roleLoading,
    keys,
    loading,
    error,
    creating,
    createError,
    newSecret,
    create,
    revoke,
    dismissSecret,
  } = useApiKeys();

  if (!roleLoading && !canManage) {
    return (
      <div>
        <h1 className="text-2xl font-semibold text-ink/80">Developers</h1>
        <p className="mt-4 text-sm text-ink/60">
          You need an admin or owner role to manage developer access.
        </p>
      </div>
    );
  }

  return (
    <div>
      <DevelopersHeader
        title="Developers"
        subtitle="Programmatic access to PaperTrail: API keys, webhooks, and the API reference."
      />

      <PortalLinks />

      <ApiKeysManager
        keys={keys}
        loading={loading}
        error={error}
        creating={creating}
        createError={createError}
        newSecret={newSecret}
        onCreate={create}
        onRevoke={revoke}
        onDismissSecret={dismissSecret}
      />
    </div>
  );
}
