"use client";

import { useState } from "react";
import type { ExperimentVariant } from "@/lib/flags/types";
import { createExperiment } from "@/components/flags/api";

// Inline create-experiment form. Starts with two control/treatment variants and
// lets the user tweak keys, names, and weights before creating.
function defaultVariants(): ExperimentVariant[] {
  return [
    { key: "control", name: "Control", weight: 50 },
    { key: "treatment", name: "Treatment", weight: 50 },
  ];
}

export function CreateExperimentCard({ onCreated }: { onCreated?: () => void }) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [variants, setVariants] = useState<ExperimentVariant[]>(defaultVariants);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setKey("");
    setName("");
    setVariants(defaultVariants());
    setError(null);
  }

  function patchVariant(index: number, patch: Partial<ExperimentVariant>) {
    setVariants((prev) =>
      prev.map((v, i) => (i === index ? { ...v, ...patch } : v))
    );
  }

  function addVariant() {
    setVariants((prev) => [
      ...prev,
      { key: `variant-${prev.length + 1}`, name: "", weight: 0 },
    ]);
  }

  function removeVariant(index: number) {
    setVariants((prev) => prev.filter((_, i) => i !== index));
  }

  async function submit() {
    const trimmedKey = key.trim();
    const trimmedName = name.trim();
    if (!trimmedKey || !trimmedName) {
      setError("Key and name are required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const res = await createExperiment({
      key: trimmedKey,
      name: trimmedName,
      variants,
    });
    setSubmitting(false);
    if (!res.success || !res.data) {
      setError(res.error ?? "Failed to create experiment.");
      return;
    }
    reset();
    setOpen(false);
    onCreated?.();
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/90"
      >
        New experiment
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-ink/10 bg-white p-4">
      <h3 className="text-sm font-semibold text-ink">Create experiment</h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-ink/60">Key</label>
          <input
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="pricing-page-test"
            className="w-full rounded-md border border-ink/10 bg-white px-3 py-1.5 font-mono text-sm focus:border-accent focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-ink/60">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Pricing page redesign"
            className="w-full rounded-md border border-ink/10 bg-white px-3 py-1.5 text-sm focus:border-accent focus:outline-none"
          />
        </div>
      </div>

      <div className="mt-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium text-ink/60">Variants</span>
          <button
            onClick={addVariant}
            className="text-xs text-accent hover:underline"
          >
            Add variant
          </button>
        </div>
        <div className="space-y-2">
          {variants.map((variant, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                value={variant.key}
                onChange={(e) => patchVariant(i, { key: e.target.value })}
                placeholder="key"
                className="w-28 rounded border border-ink/10 bg-white px-2 py-1 font-mono text-xs focus:border-accent focus:outline-none"
              />
              <input
                value={variant.name}
                onChange={(e) => patchVariant(i, { name: e.target.value })}
                placeholder="name"
                className="flex-1 rounded border border-ink/10 bg-white px-2 py-1 text-xs focus:border-accent focus:outline-none"
              />
              <input
                type="number"
                min={0}
                value={variant.weight}
                onChange={(e) =>
                  patchVariant(i, { weight: Number(e.target.value) || 0 })
                }
                className="w-16 rounded border border-ink/10 bg-white px-2 py-1 text-xs tabular-nums focus:border-accent focus:outline-none"
              />
              <button
                onClick={() => removeVariant(i)}
                disabled={variants.length <= 1}
                className="text-xs text-ink/40 hover:text-red-600 disabled:opacity-30"
                aria-label="Remove variant"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
        <p className="mt-1 text-[11px] text-ink/40">
          Weights are relative — they need not sum to 100.
        </p>
      </div>

      {error && <p className="mt-3 text-xs text-red-600">{error}</p>}

      <div className="mt-4 flex items-center gap-2">
        <button
          onClick={submit}
          disabled={submitting}
          className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-50"
        >
          {submitting ? "Creating…" : "Create experiment"}
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
