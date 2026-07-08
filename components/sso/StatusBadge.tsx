import type { SsoStatus, ScimStatus } from "@/lib/sso/types";

// Small colored pill for connection / directory lifecycle status. Presentational
// only — no data fetching.

const STYLES: Record<string, string> = {
  active: "text-green-700 border-green-600/30 bg-green-50",
  draft: "text-ink/50 border-ink/15 bg-paper",
  disabled: "text-red-600 border-red-600/20 bg-red-50",
};

export function StatusBadge({ status }: { status: SsoStatus | ScimStatus }) {
  const cls = STYLES[status] ?? STYLES.draft;
  return (
    <span
      className={`inline-block text-xs rounded px-2 py-0.5 border ${cls}`}
    >
      {status}
    </span>
  );
}

// Verified / unverified pill for a connection's domain.
export function VerifiedBadge({ verified }: { verified: boolean }) {
  return (
    <span
      className={`inline-block text-xs rounded px-2 py-0.5 border ${
        verified
          ? "text-green-700 border-green-600/30 bg-green-50"
          : "text-amber-700 border-amber-600/30 bg-amber-50"
      }`}
    >
      {verified ? "domain verified" : "domain unverified"}
    </span>
  );
}
