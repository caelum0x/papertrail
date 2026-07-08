"use client";

import { useState } from "react";
import type { PersonalToken } from "@/lib/account/types";
import { createTokenSchema } from "@/lib/account/schemas";
import { Field, TextInput, Button } from "@/components/account/fields";
import { createToken } from "../../_components/api";

interface CreateTokenDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

// Modal for minting a personal access token. Two phases: (1) name entry, then
// (2) a one-time reveal of the plaintext secret with a copy affordance. The
// plaintext is never fetched again, so the reveal step is the only chance to copy.
export function CreateTokenDialog({ open, onClose, onCreated }: CreateTokenDialogProps) {
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  if (!open) return null;

  const reset = () => {
    setName("");
    setError(null);
    setSecret(null);
    setCopied(false);
  };

  const close = () => {
    reset();
    onClose();
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const parsed = createTokenSchema.safeParse({ name });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Give the token a name.");
      return;
    }
    setCreating(true);
    const res = await createToken(parsed.data);
    setCreating(false);
    const created = res.data as PersonalToken | null;
    if (res.error || !created?.token) {
      setError(res.error ?? "Couldn't create the token.");
      return;
    }
    setSecret(created.token);
    onCreated();
  };

  const copy = async () => {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-token-title"
    >
      <div className="w-full max-w-md rounded-lg border border-ink/10 bg-white shadow-lg">
        <header className="border-b border-ink/10 px-5 py-4">
          <h2 id="create-token-title" className="text-sm font-semibold text-ink/80">
            {secret ? "Copy your token now" : "Create access token"}
          </h2>
        </header>

        {secret ? (
          <div className="space-y-4 px-5 py-4">
            <p className="text-xs text-ink/50">
              This is the only time you'll see this token. Copy it now and store it
              somewhere safe — you won't be able to view it again.
            </p>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-md border border-ink/10 bg-ink/5 px-3 py-2 text-xs text-ink/80">
                {secret}
              </code>
              <Button type="button" variant="secondary" onClick={copy}>
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <div className="flex justify-end">
              <Button type="button" onClick={close}>
                Done
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4 px-5 py-4">
            <Field
              label="Token name"
              htmlFor="token_name"
              hint="A label to help you recognize this token later."
              error={error}
            >
              <TextInput
                id="token_name"
                value={name}
                maxLength={120}
                autoFocus
                disabled={creating}
                placeholder="e.g. Local CLI"
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                disabled={creating}
                onClick={close}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={creating}>
                {creating ? "Creating…" : "Create token"}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
