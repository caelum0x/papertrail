import type { Pool } from "pg";
import type { PlanLimits } from "@/lib/billing/types";
import { getActiveSubscription } from "@/lib/billing/repository";

// ---------------------------------------------------------------------------
// Tier catalog + feature entitlements.
//
// PaperTrail packages into three purchasable tiers on top of the EXISTING
// plans + checkQuota + plan_features stack (migrations 0015 + 0065). This module
// is the TypeScript mirror of that catalog:
//
//   * TIER_CATALOG — the canonical tier definitions (numeric quota limits +
//     gated boolean features) so code has a typed, DB-independent view of what
//     each tier includes. The DB rows in `plans` / `plan_features` are the
//     enforcement source of truth; this catalog is for display + fallback.
//   * requireFeature(pool, orgId, feature) — resolves an org's current plan via
//     its active subscription, checks the plan_features entitlement, and throws a
//     typed UpgradeRequired when a gated feature is used below its tier. Callers
//     wrap it in try/catch and map UpgradeRequired -> HTTP 402/403.
//
// This module never logs claim/patient text, secrets, or PHI — only ids, tier
// keys, and feature keys. All SQL is parameterized and org-scoped via the
// subscription lookup (the org id is resolved server-side, never client-asserted).
// ---------------------------------------------------------------------------

// The stable machine keys for the three purchasable tiers. These match the
// `plans.key` values upserted in migration 0065.
export const TIER_KEYS = ["researcher", "team", "enterprise"] as const;
export type TierKey = (typeof TIER_KEYS)[number];

// The gated boolean capabilities. These match the `plan_features.feature` values
// seeded in migration 0065.
export const GATED_FEATURES = [
  "sso",
  "scim",
  "ip_allowlist",
  "audit_export",
  "esign",
  "worker_priority",
] as const;
export type GatedFeature = (typeof GATED_FEATURES)[number];

// A single tier's definition: display metadata, numeric quota caps enforced by
// checkQuota, and the set of gated features it entitles.
export interface TierDefinition {
  key: TierKey;
  name: string;
  // Sticker price in cents; enterprise is contact-sales but carries a
  // representative price for the pricing page. Kept in sync with plans.price_cents.
  priceCents: number;
  // Short marketing blurb for the pricing/entitlement page.
  tagline: string;
  // Numeric quota caps (kind -> monthly cap; -1 == unlimited). Mirrors plans.limits.
  limits: PlanLimits;
  // Which gated features this tier entitles.
  features: Readonly<Record<GatedFeature, boolean>>;
}

// The canonical, typed tier catalog. Mirrors the DB rows so UI and non-DB code
// can reason about tiers without a round-trip. Enterprise-only capabilities
// (sso, scim, ip_allowlist, audit_export, esign) are gated to 'enterprise';
// worker_priority is granted to Team and Enterprise.
export const TIER_CATALOG: Readonly<Record<TierKey, TierDefinition>> = {
  researcher: {
    key: "researcher",
    name: "Researcher",
    priceCents: 0,
    tagline:
      "For individual translational researchers verifying claims against primary sources.",
    limits: { verification: 100, claim: 500, document: 250 },
    features: {
      sso: false,
      scim: false,
      ip_allowlist: false,
      audit_export: false,
      esign: false,
      worker_priority: false,
    },
  },
  team: {
    key: "team",
    name: "Team",
    priceCents: 9900,
    tagline:
      "For disease-focused labs: shared workspace, higher quotas, priority verification workers.",
    limits: { verification: 2000, claim: 20000, document: 8000 },
    features: {
      sso: false,
      scim: false,
      ip_allowlist: false,
      audit_export: false,
      esign: false,
      worker_priority: true,
    },
  },
  enterprise: {
    key: "enterprise",
    name: "Pharma Enterprise",
    priceCents: 250000,
    tagline:
      "For regulated pharma: SSO/SCIM, IP allow-listing, immutable audit export, and 21 CFR Part 11 e-signatures.",
    limits: { verification: -1, claim: -1, document: -1 },
    features: {
      sso: true,
      scim: true,
      ip_allowlist: true,
      audit_export: true,
      esign: true,
      worker_priority: true,
    },
  },
};

// The default tier for an org that has never subscribed. Researcher is the
// free-of-gated-features baseline, aligned with FREE_PLAN behavior in
// lib/billing/period.ts.
export const DEFAULT_TIER_KEY: TierKey = "researcher";

// Human-readable labels for each gated feature — used by the console entitlement
// page so we never expose raw machine keys to the UI.
export const FEATURE_LABELS: Readonly<Record<GatedFeature, string>> = {
  sso: "Single sign-on (SSO)",
  scim: "SCIM user provisioning",
  ip_allowlist: "IP allow-listing",
  audit_export: "Immutable audit export",
  esign: "21 CFR Part 11 e-signatures",
  worker_priority: "Priority verification workers",
};

// Narrowing guard for a tier key coming from the DB or an untrusted boundary.
export function isTierKey(value: string): value is TierKey {
  return (TIER_KEYS as readonly string[]).includes(value);
}

// Narrowing guard for a gated feature key coming from an untrusted boundary.
export function isGatedFeature(value: string): value is GatedFeature {
  return (GATED_FEATURES as readonly string[]).includes(value);
}

// Typed error thrown when a gated feature is used below its entitling tier.
// Callers catch this and map it to an HTTP 402 Payment Required (or 403), with
// `feature` and `currentTier` surfaced to drive an upgrade CTA. Carries no
// sensitive data — only the feature key and the org's current tier.
export class UpgradeRequired extends Error {
  readonly feature: GatedFeature;
  readonly currentTier: TierKey;
  readonly requiredTiers: readonly TierKey[];

  constructor(feature: GatedFeature, currentTier: TierKey) {
    super(
      `Feature "${feature}" is not included in the ${currentTier} tier. ` +
        `Upgrade to ${tiersEntitling(feature).join(" or ")} to enable it.`
    );
    this.name = "UpgradeRequired";
    this.feature = feature;
    this.currentTier = currentTier;
    this.requiredTiers = tiersEntitling(feature);
    // Restore the prototype chain for instanceof across transpilation targets.
    Object.setPrototypeOf(this, UpgradeRequired.prototype);
  }
}

// The tiers (in catalog order) whose catalog definition entitles `feature`.
// Used both by UpgradeRequired messaging and by the console page.
export function tiersEntitling(feature: GatedFeature): TierKey[] {
  return TIER_KEYS.filter((key) => TIER_CATALOG[key].features[feature]);
}

// The org's entitlements: the effective tier + a map of every gated feature to
// whether the org is entitled to it. Resolved from the org's active subscription
// (plan) and the plan_features table, falling back to the catalog when a DB row
// is missing so the answer is always complete and safe.
export interface Entitlements {
  tier: TierDefinition;
  features: Record<GatedFeature, boolean>;
}

// Resolves the org's current tier key from its active subscription. An org with
// no active subscription — or one on a legacy/unknown plan key — falls back to
// the default tier. Never throws for a missing subscription; DB errors surface
// to the caller. Org-scoped: getActiveSubscription filters by org_id server-side.
export async function resolveTierKey(
  pool: Pool,
  orgId: string
): Promise<TierKey> {
  const sub = await getActiveSubscription(pool, orgId);
  if (sub && isTierKey(sub.planKey)) {
    return sub.planKey;
  }
  return DEFAULT_TIER_KEY;
}

// Reads the plan_features entitlement rows for a plan key into a complete map.
// Any feature missing a DB row falls back to the typed catalog default so the
// returned map always covers every GatedFeature. Parameterized SQL.
async function loadFeatureMap(
  pool: Pool,
  tier: TierKey
): Promise<Record<GatedFeature, boolean>> {
  const { rows } = await pool.query<{ feature: string; enabled: boolean }>(
    `select feature, enabled
       from plan_features
      where lower(plan) = lower($1)`,
    [tier]
  );

  const dbEnabled = new Map<string, boolean>();
  for (const row of rows) {
    dbEnabled.set(row.feature.toLowerCase(), row.enabled);
  }

  const catalogFeatures = TIER_CATALOG[tier].features;
  const result = {} as Record<GatedFeature, boolean>;
  for (const feature of GATED_FEATURES) {
    const fromDb = dbEnabled.get(feature);
    result[feature] = fromDb ?? catalogFeatures[feature];
  }
  return result;
}

// Whether the org is entitled to a single gated feature. Prefers the DB
// plan_features row and falls back to the catalog when absent.
export async function isFeatureEnabled(
  pool: Pool,
  orgId: string,
  feature: GatedFeature
): Promise<boolean> {
  const tier = await resolveTierKey(pool, orgId);
  const map = await loadFeatureMap(pool, tier);
  return map[feature];
}

// The full entitlement snapshot for an org: its effective tier definition plus
// every gated feature's enabled state. Used by GET /api/billing/tier and the
// console entitlement page.
export async function getEntitlements(
  pool: Pool,
  orgId: string
): Promise<Entitlements> {
  const tier = await resolveTierKey(pool, orgId);
  const features = await loadFeatureMap(pool, tier);
  return { tier: TIER_CATALOG[tier], features };
}

// Enforces that the org's tier entitles `feature`. Returns the resolved tier key
// on success; throws UpgradeRequired when the feature is gated above the org's
// tier. This is the single call sites should use to guard a gated capability
// (SSO login, SCIM sync, audit export, e-sign, etc.) before doing the work.
export async function requireFeature(
  pool: Pool,
  orgId: string,
  feature: GatedFeature
): Promise<TierKey> {
  const tier = await resolveTierKey(pool, orgId);
  const map = await loadFeatureMap(pool, tier);
  if (!map[feature]) {
    throw new UpgradeRequired(feature, tier);
  }
  return tier;
}
