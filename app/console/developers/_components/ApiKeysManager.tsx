"use client";

import { ApiKeyForm } from "./ApiKeyForm";
import { ApiKeyList } from "./ApiKeyList";
import { SecretReveal } from "./SecretReveal";
import type { ApiKeySummary } from "./types";

interface ApiKeysManagerProps {
  keys: ApiKeySummary[];
  loading: boolean;
  error: string | null;
  creating: boolean;
  createError: string | null;
  newSecret: string | null;
  onCreate: (name: string) => void;
  onRevoke: (id: string) => void;
  onDismissSecret: () => void;
  // When false, the intro blurb (shown on the portal home) is omitted so the
  // dedicated keys sub-page can supply its own header.
  showIntro?: boolean;
}

// Composes the full API-key management UX — create form, one-time secret
// reveal, and the key list — so both the developer portal home and the keys
// sub-page render identical, fully-wired controls.
export function ApiKeysManager({
  keys,
  loading,
  error,
  creating,
  createError,
  newSecret,
  onCreate,
  onRevoke,
  onDismissSecret,
  showIntro = true,
}: ApiKeysManagerProps) {
  return (
    <div>
      {showIntro ? (
        <div className="mt-8">
          <h2 className="text-lg font-semibold text-ink/80">API keys</h2>
          <p className="mt-1 text-sm text-ink/40">
            Use a key in the{" "}
            <code className="text-xs bg-paper rounded px-1 py-0.5">
              x-api-key
            </code>{" "}
            header to call <code className="text-xs">POST /api/v1/verify</code>.
            Keep keys secret.
          </p>
        </div>
      ) : null}

      <ApiKeyForm
        creating={creating}
        createError={createError}
        onCreate={onCreate}
      />

      {newSecret ? (
        <SecretReveal
          title="Copy your new key now"
          hint="This is the only time the full key will be shown. Store it somewhere safe."
          secret={newSecret}
          onDismiss={onDismissSecret}
        />
      ) : null}

      <ApiKeyList
        keys={keys}
        loading={loading}
        error={error}
        onRevoke={onRevoke}
      />
    </div>
  );
}
