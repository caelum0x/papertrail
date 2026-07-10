import Link from "next/link";
import { formatTierPrice, type TierView } from "./types";

interface CurrentTierCardProps {
  tier: TierView;
}

// The "Current tier" panel: the org's active packaging tier, its price, tagline,
// and an upgrade CTA that's hidden once the org is already on Enterprise.
export function CurrentTierCard({ tier }: CurrentTierCardProps) {
  const isTopTier = tier.key === "enterprise";
  return (
    <section className="mt-6 bg-white border border-ink/10 rounded-lg p-5">
      <h2 className="text-sm font-medium text-ink/70">Current tier</h2>
      <div className="mt-2 flex items-end justify-between gap-4">
        <div>
          <div className="text-xl font-semibold text-ink/80">{tier.name}</div>
          <p className="mt-1 text-xs text-ink/40 max-w-md">{tier.tagline}</p>
        </div>
        <div className="text-right shrink-0">
          <div className="text-lg font-semibold text-ink/80 tabular-nums">
            {formatTierPrice(tier.priceCents)}
          </div>
          {!isTopTier && (
            <Link
              href="/console/settings/billing"
              className="mt-2 inline-block text-sm bg-accent text-white rounded px-4 py-2"
            >
              Upgrade
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}
