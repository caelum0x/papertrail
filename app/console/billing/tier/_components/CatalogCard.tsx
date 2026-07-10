import {
  formatTierPrice,
  formatLimit,
  GATED_FEATURES,
  type TierView,
} from "./types";

interface CatalogCardProps {
  catalog: TierView[];
  currentKey: TierView["key"];
}

// Human labels for the gated features, kept local to the presentational layer so
// the API stays the source of truth for the machine keys.
const FEATURE_LABELS: Record<(typeof GATED_FEATURES)[number], string> = {
  sso: "SSO",
  scim: "SCIM provisioning",
  ip_allowlist: "IP allow-listing",
  audit_export: "Immutable audit export",
  esign: "Part 11 e-signatures",
  worker_priority: "Priority workers",
};

const QUOTA_KINDS: readonly string[] = ["verification", "claim", "document"];

// Side-by-side tier comparison: quota caps + gated features per tier, with the
// org's current tier highlighted. Purely presentational catalog reference data.
export function CatalogCard({ catalog, currentKey }: CatalogCardProps) {
  return (
    <section className="mt-6 bg-white border border-ink/10 rounded-lg p-5">
      <h2 className="text-sm font-medium text-ink/70">Compare tiers</h2>
      <div className="mt-4 grid gap-4 md:grid-cols-3">
        {catalog.map((tier) => {
          const isCurrent = tier.key === currentKey;
          return (
            <div
              key={tier.key}
              className={
                "rounded-lg border p-4 " +
                (isCurrent
                  ? "border-accent ring-1 ring-accent/30"
                  : "border-ink/10")
              }
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-ink/80">
                  {tier.name}
                </span>
                {isCurrent && (
                  <span className="text-[10px] uppercase tracking-wide font-medium text-accent">
                    Current
                  </span>
                )}
              </div>
              <div className="mt-1 text-lg font-semibold text-ink/80 tabular-nums">
                {formatTierPrice(tier.priceCents)}
              </div>

              <dl className="mt-3 space-y-1">
                {QUOTA_KINDS.map((kind) => (
                  <div key={kind} className="flex justify-between text-xs">
                    <dt className="text-ink/50 capitalize">{kind}s / mo</dt>
                    <dd className="text-ink/70 tabular-nums">
                      {formatLimit(tier.limits[kind] ?? -1)}
                    </dd>
                  </div>
                ))}
              </dl>

              <ul className="mt-3 space-y-1">
                {GATED_FEATURES.map((feature) => {
                  const on = tier.features[feature];
                  return (
                    <li
                      key={feature}
                      className={
                        "flex items-center gap-2 text-xs " +
                        (on ? "text-ink/70" : "text-ink/30")
                      }
                    >
                      <span aria-hidden>{on ? "✓" : "—"}</span>
                      <span>{FEATURE_LABELS[feature]}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}
