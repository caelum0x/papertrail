"use client";

import { useCallback, useState } from "react";
import type { SsoConnection, DomainVerifyResult } from "@/lib/sso/types";
import { updateConnection, verifyDomain } from "@/components/sso/api";
import { VerifiedBadge } from "@/components/sso/StatusBadge";

// "Domain" tab of the connection detail: set / change the claimed email domain
// and run DNS TXT ownership verification. Shows the exact TXT record to publish
// and the current verification state.

interface DomainVerifyPanelProps {
  connection: SsoConnection;
  onUpdated: (next: SsoConnection) => void;
}

export function DomainVerifyPanel({
  connection,
  onUpdated,
}: DomainVerifyPanelProps) {
  const [domain, setDomain] = useState(connection.domain ?? "");
  const [savingDomain, setSavingDomain] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DomainVerifyResult | null>(null);

  const onSaveDomain = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);
      setResult(null);
      const trimmed = domain.trim();
      if (!trimmed) {
        setError("Enter a domain to verify.");
        return;
      }
      setSavingDomain(true);
      try {
        const next = await updateConnection(connection.id, { domain: trimmed });
        onUpdated(next);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save domain.");
      } finally {
        setSavingDomain(false);
      }
    },
    [domain, connection.id, onUpdated]
  );

  const onVerify = useCallback(async () => {
    setError(null);
    setVerifying(true);
    try {
      const res = await verifyDomain(connection.id);
      setResult(res);
      if (res.verified) {
        onUpdated({ ...connection, verified: true });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed.");
    } finally {
      setVerifying(false);
    }
  }, [connection, onUpdated]);

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center gap-2">
        <span className="text-sm text-ink/70">Domain ownership</span>
        <VerifiedBadge verified={connection.verified} />
      </div>

      <form onSubmit={onSaveDomain} className="space-y-3">
        <label htmlFor="verify-domain" className="block text-xs text-ink/60">
          Email domain
        </label>
        <div className="flex gap-2">
          <input
            id="verify-domain"
            type="text"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            maxLength={255}
            placeholder="lab.example.edu"
            className="flex-1 text-sm font-mono border border-ink/15 rounded px-3 py-2 focus:outline-none focus:border-accent"
          />
          <button
            type="submit"
            disabled={savingDomain}
            className="text-sm border border-ink/15 rounded px-3 py-2 hover:border-accent disabled:opacity-50"
          >
            {savingDomain ? "Saving…" : "Save"}
          </button>
        </div>
        <p className="text-xs text-ink/40">
          Changing the domain resets verification.
        </p>
      </form>

      {connection.domain ? (
        <div className="bg-paper border border-ink/10 rounded-lg p-4">
          <p className="text-sm text-ink/70">
            Add this DNS <span className="font-mono">TXT</span> record to{" "}
            <span className="font-mono">{connection.domain}</span>, then verify:
          </p>
          <pre className="mt-2 text-xs bg-white border border-ink/10 rounded p-3 overflow-x-auto">
            {result?.token ?? "papertrail-verify=… (run verify to generate)"}
          </pre>
          <button
            onClick={onVerify}
            disabled={verifying}
            className="mt-3 text-sm bg-accent text-white rounded px-4 py-2 disabled:opacity-50"
          >
            {verifying ? "Checking DNS…" : "Verify domain"}
          </button>
        </div>
      ) : (
        <p className="text-sm text-ink/50">
          Set a domain above to begin verification.
        </p>
      )}

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {result ? (
        <p
          className={`text-sm ${
            result.verified ? "text-green-700" : "text-amber-700"
          }`}
        >
          {result.detail}
        </p>
      ) : null}
    </div>
  );
}
