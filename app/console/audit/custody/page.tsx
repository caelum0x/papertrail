"use client";

import { useCallback, useState } from "react";
import { getJson } from "@/components/admin-audit/apiClient";
import { CustodyTable } from "./_components/CustodyTable";
import type { ChainOfCustodyView } from "./_components/types";

// Chain-of-custody console: look up a verification id and reconstruct its exact
// provenance state (21 CFR Part 11-grade) — every grounded span with its source
// identifiers, snapshot version, and a deterministic chain-of-custody hash. The
// "verify hash" buttons recompute each hash in the browser to prove nothing was
// tampered. Read-only; backed by GET /api/audit-chain/verification/[id] (viewer+).

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function CustodyPage() {
  const [verificationId, setVerificationId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [custody, setCustody] = useState<ChainOfCustodyView | null>(null);

  const lookup = useCallback(async () => {
    const id = verificationId.trim();
    if (!UUID_RE.test(id)) {
      setError("Enter a valid verification id (UUID).");
      setCustody(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await getJson<ChainOfCustodyView>(
        `/api/audit-chain/verification/${id}`
      );
      if (!res.success || !res.data) {
        throw new Error(res.error ?? "Could not load chain of custody.");
      }
      setCustody(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lookup failed.");
      setCustody(null);
    } finally {
      setLoading(false);
    }
  }, [verificationId]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-ink">Chain of custody</h2>
        <p className="mt-1 text-sm text-ink/40">
          Reconstruct the immutable provenance of a verification: every grounded span
          tied to its source, snapshot version, and a deterministic custody hash you
          can verify in-browser.
        </p>
      </div>

      <div className="rounded-lg border border-ink/15 bg-paper p-4">
        <label
          className="block text-sm font-medium text-ink/70"
          htmlFor="verification-id"
        >
          Verification id
        </label>
        <div className="mt-1 flex gap-2">
          <input
            id="verification-id"
            type="text"
            value={verificationId}
            onChange={(e) => setVerificationId(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void lookup();
            }}
            placeholder="00000000-0000-0000-0000-000000000000"
            className="w-full rounded-md border border-ink/15 bg-paper px-3 py-2 font-mono text-sm text-ink focus:border-accent focus:outline-none"
          />
          <button
            type="button"
            onClick={() => void lookup()}
            disabled={loading}
            className="whitespace-nowrap rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {loading ? "Loading…" : "Look up"}
          </button>
        </div>

        {error ? (
          <p className="mt-3 text-sm text-red-700" role="alert">
            {error}
          </p>
        ) : null}
      </div>

      {custody ? <CustodyTable custody={custody} /> : null}
    </div>
  );
}
