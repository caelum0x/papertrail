"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ENTITY_TYPES } from "@/lib/signatures/types";
import { createRequest } from "@/components/signatures/api";
import { ErrorState } from "@/components/signatures/ui";
import { SignerPicker } from "./SignerPicker";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Form to create a signature request: what entity is being signed, a title, and
// the ordered signers. On success, navigates to the new request's detail page.
export function RequestForm() {
  const router = useRouter();

  const [entityType, setEntityType] = useState<string>(ENTITY_TYPES[0]);
  const [entityId, setEntityId] = useState("");
  const [title, setTitle] = useState("");
  const [signerUserIds, setSignerUserIds] = useState<string[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const entityIdValid = UUID_RE.test(entityId.trim());
  const canSubmit =
    !submitting && title.trim().length > 0 && entityIdValid;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    const result = await createRequest({
      entityType: entityType.trim(),
      entityId: entityId.trim(),
      title: title.trim(),
      signerUserIds,
    });
    if (result.error || !result.data) {
      setError(result.error ?? "Failed to create signature request.");
      setSubmitting(false);
      return;
    }
    router.push(`/console/signatures/${result.data.request.id}`);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <div className="rounded-lg border border-ink/10 bg-white p-5">
        <h2 className="text-sm font-semibold text-ink">What is being signed</h2>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs font-medium uppercase tracking-wide text-ink/40">
              Entity type
            </span>
            <input
              list="signature-entity-types"
              value={entityType}
              onChange={(e) => setEntityType(e.target.value)}
              className="mt-1 w-full rounded-md border border-ink/10 bg-white px-3 py-1.5 text-sm text-ink/70"
              placeholder="claim"
            />
            <datalist id="signature-entity-types">
              {ENTITY_TYPES.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </label>

          <label className="block">
            <span className="text-xs font-medium uppercase tracking-wide text-ink/40">
              Entity id (uuid)
            </span>
            <input
              value={entityId}
              onChange={(e) => setEntityId(e.target.value)}
              className="mt-1 w-full rounded-md border border-ink/10 bg-white px-3 py-1.5 font-mono text-sm text-ink/70"
              placeholder="00000000-0000-0000-0000-000000000000"
            />
            {entityId.length > 0 && !entityIdValid ? (
              <span className="mt-1 block text-xs text-red-600">
                Must be a valid uuid.
              </span>
            ) : null}
          </label>
        </div>

        <label className="mt-4 block">
          <span className="text-xs font-medium uppercase tracking-wide text-ink/40">
            Title
          </span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={300}
            className="mt-1 w-full rounded-md border border-ink/10 bg-white px-3 py-1.5 text-sm text-ink/70"
            placeholder="Sign-off: Drug X efficacy verification"
          />
        </label>
      </div>

      <div className="rounded-lg border border-ink/10 bg-white p-5">
        <h2 className="text-sm font-semibold text-ink">Signers</h2>
        <p className="mt-1 text-sm text-ink/60">
          Signers sign in the order below. You can add more later while the
          request is still open.
        </p>
        <div className="mt-4">
          <SignerPicker
            selected={signerUserIds}
            onChange={setSignerUserIds}
            disabled={submitting}
          />
        </div>
      </div>

      {error ? <ErrorState message={error} /> : null}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={!canSubmit}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {submitting ? "Creating…" : "Create request"}
        </button>
        <span className="text-xs text-ink/40">
          {signerUserIds.length === 0
            ? "No signers yet — the request will start as a draft."
            : `${signerUserIds.length} signer${
                signerUserIds.length === 1 ? "" : "s"
              } · starts awaiting signatures.`}
        </span>
      </div>
    </form>
  );
}
