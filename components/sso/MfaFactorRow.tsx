"use client";

import type { MfaFactor } from "@/lib/sso/types";

// One MFA factor row on the security page. Presentational; delete is delegated
// to the parent.

const TYPE_LABELS: Record<string, string> = {
  totp: "Authenticator app (TOTP)",
  recovery: "Recovery codes",
};

interface MfaFactorRowProps {
  factor: MfaFactor;
  busy: boolean;
  onDelete: (id: string) => void;
}

export function MfaFactorRow({ factor, busy, onDelete }: MfaFactorRowProps) {
  return (
    <li className="px-4 py-3 flex items-center justify-between gap-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm text-ink/80">
            {TYPE_LABELS[factor.type] ?? factor.type}
          </span>
          {factor.verified ? (
            <span className="text-xs rounded px-2 py-0.5 border text-green-700 border-green-600/30 bg-green-50">
              active
            </span>
          ) : (
            <span className="text-xs rounded px-2 py-0.5 border text-amber-700 border-amber-600/30 bg-amber-50">
              pending
            </span>
          )}
        </div>
        <div className="text-xs text-ink/40">
          Added {new Date(factor.createdAt).toLocaleDateString()}
        </div>
      </div>
      <button
        onClick={() => onDelete(factor.id)}
        disabled={busy}
        className="text-xs text-red-600 hover:underline disabled:opacity-40 shrink-0"
      >
        Remove
      </button>
    </li>
  );
}
