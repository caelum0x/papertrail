// Shared view types + formatters for the tier/entitlement console page. These
// mirror the { currentTier, entitlements, catalog } shape returned by
// GET /api/billing/tier so the page and its presentational components agree.

export const GATED_FEATURES = [
  "sso",
  "scim",
  "ip_allowlist",
  "audit_export",
  "esign",
  "worker_priority",
] as const;
export type GatedFeature = (typeof GATED_FEATURES)[number];

export type TierKey = "researcher" | "team" | "enterprise";

export interface TierView {
  key: TierKey;
  name: string;
  priceCents: number;
  tagline: string;
  limits: Record<string, number>;
  features: Record<GatedFeature, boolean>;
}

export interface FeatureEntitlementView {
  feature: GatedFeature;
  label: string;
  enabled: boolean;
  entitledTiers: TierKey[];
}

export interface TierResponse {
  currentTier: TierView;
  entitlements: FeatureEntitlementView[];
  catalog: TierView[];
}

// Formats a cents price for display. Enterprise is contact-sales; a 0 price
// renders as "Free" and any other as "$X/mo".
export function formatTierPrice(priceCents: number): string {
  if (priceCents === 0) return "Free";
  const dollars = priceCents / 100;
  const formatted = dollars.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
  return `$${formatted}/mo`;
}

// Formats a numeric quota cap: -1 renders as "Unlimited", otherwise a grouped
// integer.
export function formatLimit(cap: number): string {
  if (cap < 0) return "Unlimited";
  return cap.toLocaleString();
}

// Title-cases a tier key for inline prose (e.g. upgrade CTAs).
export function tierLabel(key: TierKey): string {
  switch (key) {
    case "researcher":
      return "Researcher";
    case "team":
      return "Team";
    case "enterprise":
      return "Pharma Enterprise";
  }
}
