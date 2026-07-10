"use client";

import { BillingHeader } from "../_components/BillingHeader";
import { CurrentTierCard } from "./_components/CurrentTierCard";
import { EntitlementsCard } from "./_components/EntitlementsCard";
import { CatalogCard } from "./_components/CatalogCard";
import { useTier } from "./_components/useTier";

// /console/billing/tier — the packaging & entitlement page. Shows the org's
// current tier, its gated-feature entitlements, and a side-by-side catalog with
// an upgrade CTA. Read-only; upgrades route to the existing plan-management flow.
export default function TierPage() {
  const { data, loading, error } = useTier();

  return (
    <div className="max-w-3xl">
      <BillingHeader
        title="Plan & tiers"
        subtitle="Your packaging tier, feature entitlements, and how to upgrade."
        action={{ href: "/console/billing", label: "Back to billing" }}
      />

      {loading ? (
        <p className="mt-6 text-sm text-ink/40">Loading tier…</p>
      ) : error ? (
        <p className="mt-6 text-sm text-red-600">{error}</p>
      ) : data ? (
        <>
          <CurrentTierCard tier={data.currentTier} />
          <EntitlementsCard entitlements={data.entitlements} />
          <CatalogCard catalog={data.catalog} currentKey={data.currentTier.key} />
        </>
      ) : (
        <p className="mt-6 text-sm text-ink/40">No tier information available.</p>
      )}
    </div>
  );
}
