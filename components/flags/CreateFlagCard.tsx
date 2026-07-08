"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createFlag } from "@/components/flags/api";
import { Toggle } from "@/components/flags/ui";

// Inline create-flag form rendered above the flag list. On success it routes
// to the new flag's detail page where rollout and rules are configured.
export function CreateFlagCard({ onCreated }: { onCreated?: () => void }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [description, setDescription] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setKey("");
    setDescription("");
    setEnabled(false);
    setError(null);
  }

  async function submit() {
    const trimmed = key.trim();
    if (!trimmed) {
      setError("A flag key is required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const res = await createFlag({
      key: trimmed,
      description: description.trim() || null,
      enabled,
    });
    setSubmitting(false);
    if (!res.success || !res.data) {
      setError(res.error ?? "Failed to create flag.");
      return;
    }
    reset();
    setOpen(false);
    onCreated?.();
    router.push(`/console/admin/flags/${res.data.id}`);
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/90"
      >
        New flag
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-ink/10 bg-white p-4">
      <h3 className="text-sm font-semibold text-ink">Create feature flag</h3>
      <div className="mt-3 space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-ink/60">
            Key
          </label>
          <input
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="new-checkout-flow"
            className="w-full rounded-md border border-ink/10 bg-white px-3 py-1.5 font-mono text-sm text-ink placeholder:text-ink/30 focus:border-accent focus:outline-none"
          />
          <p className="mt-1 text-[11px] text-ink/40">
            Lowercase, with letters, numbers, and _ . or -.
          </p>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-ink/60">
            Description
          </label>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional — what does this flag gate?"
            className="w-full rounded-md border border-ink/10 bg-white px-3 py-1.5 text-sm text-ink placeholder:text-ink/30 focus:border-accent focus:outline-none"
          />
        </div>
        <div className="flex items-center gap-2">
          <Toggle checked={enabled} onChange={setEnabled} label="Enabled" />
          <span className="text-sm text-ink/60">
            Enable immediately on create
          </span>
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
      <div className="mt-4 flex items-center gap-2">
        <button
          onClick={submit}
          disabled={submitting}
          className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-50"
        >
          {submitting ? "Creating…" : "Create flag"}
        </button>
        <button
          onClick={() => {
            reset();
            setOpen(false);
          }}
          disabled={submitting}
          className="rounded-md border border-ink/10 px-3 py-1.5 text-sm text-ink/60 hover:bg-paper"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
