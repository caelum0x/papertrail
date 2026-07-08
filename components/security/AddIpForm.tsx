"use client";

import { useState, useCallback } from "react";
import { addIpEntry } from "./api";
import type { IpAllowlistEntry } from "@/lib/security/types";

// Form to add a CIDR range to the IP allowlist. Validates non-empty locally and
// relies on the server for full CIDR validation, surfacing its error message.
// Calls onAdded with the created entry so the parent can prepend it to the list.

interface AddIpFormProps {
  onAdded: (entry: IpAllowlistEntry) => void;
}

export function AddIpForm({ onAdded }: AddIpFormProps) {
  const [cidr, setCidr] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setSubmitting(true);
      setError(null);
      try {
        const entry = await addIpEntry({
          cidr: cidr.trim(),
          note: note.trim() || undefined,
        });
        setCidr("");
        setNote("");
        onAdded(entry);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Couldn't add the entry."
        );
      } finally {
        setSubmitting(false);
      }
    },
    [cidr, note, onAdded]
  );

  return (
    <form
      onSubmit={onSubmit}
      className="bg-white border border-ink/15 rounded-lg p-5 space-y-4"
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label className="block">
          <span className="text-sm text-ink/60">CIDR range</span>
          <input
            value={cidr}
            onChange={(e) => setCidr(e.target.value)}
            required
            placeholder="e.g. 203.0.113.0/24"
            className="mt-1 w-full rounded border border-ink/15 px-2 py-1.5 text-sm font-mono focus:outline-none focus:border-accent"
          />
        </label>
        <label className="block">
          <span className="text-sm text-ink/60">Note (optional)</span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Office VPN"
            className="mt-1 w-full rounded border border-ink/15 px-2 py-1.5 text-sm focus:outline-none focus:border-accent"
          />
        </label>
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={submitting || cidr.trim().length === 0}
          className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? "Adding…" : "Add to allowlist"}
        </button>
      </div>
    </form>
  );
}
