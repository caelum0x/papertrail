"use client";

import Link from "next/link";
import type { UpgradeDetail } from "./types";

// Rendered when the org's tier does not entitle audit_export (HTTP 402). Shows
// the current tier, the tiers that unlock the feature, and a link to the plan
// page. Carries only non-sensitive catalog metadata.

interface UpgradeCTAProps {
  detail: UpgradeDetail;
  message: string;
}

const TIER_LABELS: Record<string, string> = {
  researcher: "Researcher",
  team: "Team",
  enterprise: "Pharma Enterprise",
};

function tierLabel(key: string): string {
  return TIER_LABELS[key] ?? key;
}

export function UpgradeCTA({ detail, message }: UpgradeCTAProps) {
  const required = detail.requiredTiers.map(tierLabel).join(" or ");
  return (
    <div className="rounded-lg border border-amber-300/60 bg-amber-50 p-6">
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-amber-200 px-2 py-0.5 text-xs font-semibold text-amber-900">
          Upgrade required
        </span>
        <h3 className="text-sm font-semibold text-amber-900">
          Immutable audit export
        </h3>
      </div>
      <p className="mt-3 text-sm text-amber-900/80">{message}</p>
      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-xs uppercase tracking-wide text-amber-900/60">
            Your plan
          </dt>
          <dd className="mt-0.5 font-medium text-amber-900">
            {tierLabel(detail.currentTier)}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-amber-900/60">
            Unlocks on
          </dt>
          <dd className="mt-0.5 font-medium text-amber-900">{required}</dd>
        </div>
      </dl>
      <div className="mt-5 flex gap-3">
        <Link
          href="/console/billing/tier"
          className="rounded-md bg-amber-900 px-4 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          View plans & upgrade
        </Link>
        <Link
          href="/console/audit"
          className="rounded-md border border-amber-300 px-4 py-2 text-sm font-medium text-amber-900 hover:bg-amber-100"
        >
          Back to audit log
        </Link>
      </div>
    </div>
  );
}
