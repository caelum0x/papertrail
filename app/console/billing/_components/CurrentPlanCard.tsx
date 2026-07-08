import Link from "next/link";
import { formatCents } from "@/components/billing/apiClient";
import { formatDate, type Subscription } from "./types";

interface CurrentPlanCardProps {
  subscription: Subscription | null;
}

// The "Current plan" panel — shows the active subscription, or a free-tier
// upsell when the org has no paid subscription.
export function CurrentPlanCard({ subscription }: CurrentPlanCardProps) {
  return (
    <section className="mt-6 bg-white border border-ink/10 rounded-lg p-5">
      <h2 className="text-sm font-medium text-ink/70">Current plan</h2>
      {subscription ? (
        <div className="mt-2 flex items-end justify-between">
          <div>
            <div className="text-xl font-semibold text-ink/80">
              {subscription.planName}
            </div>
            <div className="mt-1 text-xs text-ink/40">
              {subscription.seats} seat
              {subscription.seats === 1 ? "" : "s"} · status{" "}
              <span className="capitalize">{subscription.status}</span> · renews{" "}
              {formatDate(subscription.currentPeriodEnd)}
            </div>
          </div>
          <div className="text-lg font-semibold text-ink/80 tabular-nums">
            {subscription.priceCents === 0
              ? "Free"
              : `${formatCents(subscription.priceCents)}/mo`}
          </div>
        </div>
      ) : (
        <div className="mt-2 flex items-end justify-between">
          <div>
            <div className="text-xl font-semibold text-ink/80">Free</div>
            <div className="mt-1 text-xs text-ink/40">
              No paid subscription — you&apos;re on the free tier.
            </div>
          </div>
          <Link
            href="/console/settings/billing"
            className="text-sm bg-accent text-white rounded px-4 py-2"
          >
            Upgrade
          </Link>
        </div>
      )}
    </section>
  );
}
