"use client";

import { DevelopersHeader } from "../_components/DevelopersHeader";
import { WebhookForm } from "../_components/WebhookForm";
import { WebhookList } from "../_components/WebhookList";
import { SecretReveal } from "../_components/SecretReveal";
import { useWebhooks } from "../_components/useWebhooks";

// Webhooks manager: register endpoints, choose events, test delivery, revoke.
// Admin+ only (enforced client-side for UX and server-side by the API).
export default function WebhooksPage() {
  const {
    canManage,
    roleLoading,
    hooks,
    loading,
    error,
    creating,
    createError,
    newSecret,
    testResult,
    create,
    remove,
    toggleStatus,
    test,
    dismissSecret,
  } = useWebhooks();

  if (!roleLoading && !canManage) {
    return (
      <div>
        <h1 className="text-2xl font-semibold text-ink/80">Webhooks</h1>
        <p className="mt-4 text-sm text-ink/60">
          You need an admin or owner role to manage webhooks.
        </p>
      </div>
    );
  }

  return (
    <div>
      <DevelopersHeader
        title="Webhooks"
        subtitle={
          <>
            Register an endpoint to receive signed event notifications. Each
            delivery includes an{" "}
            <code className="text-xs bg-paper rounded px-1 py-0.5">
              X-PaperTrail-Signature
            </code>{" "}
            HMAC header — verify it against the signing secret.
          </>
        }
        link={{ href: "/console/developers", label: "← Developers" }}
      />

      <WebhookForm
        creating={creating}
        createError={createError}
        onCreate={create}
      />

      {newSecret ? (
        <SecretReveal
          title="Copy the signing secret now"
          hint="This is the only time the full secret will be shown. Use it to verify the signature on every delivery."
          secret={newSecret}
          onDismiss={dismissSecret}
        />
      ) : null}

      <WebhookList
        hooks={hooks}
        loading={loading}
        error={error}
        testResult={testResult}
        onTest={test}
        onToggleStatus={toggleStatus}
        onDelete={remove}
      />
    </div>
  );
}
