"use client";

import { BillingHeader } from "../_components/BillingHeader";
import { CurrentPlanCard } from "../_components/CurrentPlanCard";
import { UsageCard } from "../_components/UsageCard";
import { useBilling } from "../_components/useBilling";

// Focused usage sub-page: the current plan and this period's meters, without
// the invoice history. Reuses the shared /api/billing/* fetch — no new APIs.
export default function BillingUsagePage() {
  const { subscription, usage, loading, error } = useBilling();

  return (
    <div className="max-w-3xl">
      <BillingHeader
        title="Usage"
        subtitle="What you've consumed against your plan limits this billing period."
        action={{ href: "/console/billing", label: "← Billing" }}
      />

      {loading ? (
        <p className="mt-6 text-sm text-ink/40">Loading usage...</p>
      ) : error ? (
        <p className="mt-6 text-sm text-red-600">{error}</p>
      ) : (
        <>
          <CurrentPlanCard subscription={subscription} />
          <UsageCard usage={usage} />
        </>
      )}
    </div>
  );
}
