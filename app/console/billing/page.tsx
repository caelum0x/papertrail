"use client";

import { BillingHeader } from "./_components/BillingHeader";
import { CurrentPlanCard } from "./_components/CurrentPlanCard";
import { UsageCard } from "./_components/UsageCard";
import { InvoicesCard } from "./_components/InvoicesCard";
import { useBilling } from "./_components/useBilling";

export default function BillingPage() {
  const { subscription, usage, invoices, loading, error } = useBilling();

  return (
    <div className="max-w-3xl">
      <BillingHeader
        title="Billing"
        subtitle="Your plan, usage this period, and invoice history."
        action={{ href: "/console/settings/billing", label: "Manage plan" }}
      />

      {loading ? (
        <p className="mt-6 text-sm text-ink/40">Loading billing...</p>
      ) : error ? (
        <p className="mt-6 text-sm text-red-600">{error}</p>
      ) : (
        <>
          <CurrentPlanCard subscription={subscription} />
          <UsageCard usage={usage} />
          <InvoicesCard invoices={invoices} />
        </>
      )}
    </div>
  );
}
