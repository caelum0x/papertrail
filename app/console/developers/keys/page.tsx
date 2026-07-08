"use client";

import { DevelopersHeader } from "../_components/DevelopersHeader";
import { ApiKeysManager } from "../_components/ApiKeysManager";
import { useApiKeys } from "../_components/useApiKeys";

// Dedicated API-keys management sub-page: the same create / reveal / revoke flow
// from the portal home, on its own route for direct linking. Reuses the shared
// useApiKeys hook and the existing /api/api-keys endpoints.
export default function DeveloperKeysPage() {
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
        <h1 className="text-2xl font-semibold text-ink/80">API keys</h1>
        <p className="mt-4 text-sm text-ink/60">
          You need an admin or owner role to manage API keys.
        </p>
      </div>
    );
  }

  return (
    <div>
      <DevelopersHeader
        title="API keys"
        subtitle={
          <>
            Use a key in the{" "}
            <code className="text-xs bg-paper rounded px-1 py-0.5">
              x-api-key
            </code>{" "}
            header to call{" "}
            <code className="text-xs">POST /api/v1/verify</code>. Keep keys
            secret.
          </>
        }
        link={{ href: "/console/developers", label: "← Developers" }}
      />

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
        showIntro={false}
      />
    </div>
  );
}
