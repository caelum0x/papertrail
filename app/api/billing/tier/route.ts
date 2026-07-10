import { NextRequest } from "next/server";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { getPool } from "@/lib/db";
import {
  getEntitlements,
  TIER_CATALOG,
  TIER_KEYS,
  GATED_FEATURES,
  FEATURE_LABELS,
  tiersEntitling,
  type GatedFeature,
  type TierKey,
} from "@/lib/billing/tiers";

export const runtime = "nodejs";

// The per-feature entitlement view returned to the console: the feature key, a
// human label, whether THIS org is entitled, and which tiers unlock it (for the
// upgrade CTA). Never exposes any tenant or PHI data — only catalog metadata.
interface FeatureEntitlementView {
  feature: GatedFeature;
  label: string;
  enabled: boolean;
  entitledTiers: TierKey[];
}

// A tier catalog entry as returned to the client (numeric limits + gated
// features), so the pricing/entitlement page can render every tier and highlight
// the current one without a second round-trip.
interface TierView {
  key: TierKey;
  name: string;
  priceCents: number;
  tagline: string;
  limits: Record<string, number>;
  features: Record<GatedFeature, boolean>;
}

interface TierResponse {
  currentTier: TierView;
  entitlements: FeatureEntitlementView[];
  catalog: TierView[];
}

function toTierView(key: TierKey): TierView {
  const def = TIER_CATALOG[key];
  return {
    key: def.key,
    name: def.name,
    priceCents: def.priceCents,
    tagline: def.tagline,
    limits: { ...def.limits },
    features: { ...def.features },
  };
}

// GET /api/billing/tier — the org's current tier + its gated-feature
// entitlements, plus the full tier catalog for the upgrade UI. Any authenticated
// member may view. Org-scoped: entitlements are resolved from ctx.org.id only.
export const GET = withOrg(async (_req: NextRequest, ctx: Ctx) => {
  try {
    const pool = getPool();
    const entitlements = await getEntitlements(pool, ctx.org.id);

    const featureViews: FeatureEntitlementView[] = GATED_FEATURES.map(
      (feature) => ({
        feature,
        label: FEATURE_LABELS[feature],
        enabled: entitlements.features[feature],
        entitledTiers: tiersEntitling(feature),
      })
    );

    const response: TierResponse = {
      currentTier: toTierView(entitlements.tier.key),
      entitlements: featureViews,
      catalog: TIER_KEYS.map(toTierView),
    };

    return ok<TierResponse>(response);
  } catch (err) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to load tier entitlements.", 500);
  }
});
