import {
  tierLabel,
  type FeatureEntitlementView,
} from "./types";

interface EntitlementsCardProps {
  entitlements: FeatureEntitlementView[];
}

// The gated-feature entitlement table: every capability, whether THIS org has
// it, and — when it doesn't — which tiers unlock it, driving the upgrade CTA.
export function EntitlementsCard({ entitlements }: EntitlementsCardProps) {
  return (
    <section className="mt-6 bg-white border border-ink/10 rounded-lg p-5">
      <h2 className="text-sm font-medium text-ink/70">Feature entitlements</h2>
      <p className="mt-1 text-xs text-ink/40">
        Enterprise governance controls (SSO/SCIM, IP allow-listing, immutable
        audit export, and 21 CFR Part 11 e-signatures) are gated to the Pharma
        Enterprise tier.
      </p>
      <ul className="mt-4 divide-y divide-ink/5">
        {entitlements.map((item) => (
          <li
            key={item.feature}
            className="flex items-center justify-between py-2.5 gap-4"
          >
            <span className="text-sm text-ink/70">{item.label}</span>
            {item.enabled ? (
              <span className="text-xs font-medium text-emerald-700 bg-emerald-50 rounded px-2 py-1">
                Included
              </span>
            ) : (
              <span className="text-xs text-ink/40">
                {item.entitledTiers.length > 0
                  ? `Requires ${item.entitledTiers.map(tierLabel).join(" or ")}`
                  : "Not available"}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
