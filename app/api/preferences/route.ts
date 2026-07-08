import { NextRequest } from "next/server";
import { z } from "zod";
import { getPool } from "@/lib/db";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { writeAudit } from "@/lib/audit";

export const runtime = "nodejs";

// Structured UI preferences. These live inside user_profiles.prefs (migration 0019)
// as a jsonb map, but we expose/validate a known, typed subset here so the settings
// UI has a stable contract. Unknown keys already stored in prefs are preserved on
// write (we merge rather than replace).

export type Theme = "system" | "light" | "dark";
export type Density = "comfortable" | "compact";
export type LandingView = "dashboard" | "claims" | "reports";

export interface Preferences {
  theme: Theme;
  density: Density;
  landingView: LandingView;
  emailDigest: boolean;
  onboardingComplete: boolean;
}

const DEFAULT_PREFERENCES: Preferences = {
  theme: "system",
  density: "comfortable",
  landingView: "dashboard",
  emailDigest: true,
  onboardingComplete: false,
};

// PATCH accepts any subset of the known preference keys. Omitted keys are left at
// their current value. Strict so typos surface as validation errors rather than
// silently polluting the jsonb blob.
const updatePreferencesSchema = z
  .object({
    theme: z.enum(["system", "light", "dark"]).optional(),
    density: z.enum(["comfortable", "compact"]).optional(),
    landing_view: z.enum(["dashboard", "claims", "reports"]).optional(),
    email_digest: z.boolean().optional(),
    onboarding_complete: z.boolean().optional(),
  })
  .strict();

function statusOf(err: unknown): number | null {
  if (err instanceof Error && "status" in err) {
    return (err as { status: number }).status;
  }
  return null;
}

// Reads the raw prefs jsonb for this (org, user), tolerant of missing rows/keys.
async function loadRawPrefs(
  orgId: string,
  userId: string
): Promise<Record<string, unknown>> {
  const { rows } = await getPool().query(
    `select prefs from user_profiles
      where org_id = $1 and user_id = $2
      limit 1`,
    [orgId, userId]
  );
  return (rows[0]?.prefs as Record<string, unknown>) ?? {};
}

// Projects the raw jsonb blob onto the typed Preferences view, falling back to
// defaults for any key that is absent or malformed. Never trusts the stored shape.
function projectPreferences(raw: Record<string, unknown>): Preferences {
  const themeOk = (v: unknown): v is Theme =>
    v === "system" || v === "light" || v === "dark";
  const densityOk = (v: unknown): v is Density =>
    v === "comfortable" || v === "compact";
  const landingOk = (v: unknown): v is LandingView =>
    v === "dashboard" || v === "claims" || v === "reports";

  return {
    theme: themeOk(raw.theme) ? raw.theme : DEFAULT_PREFERENCES.theme,
    density: densityOk(raw.density) ? raw.density : DEFAULT_PREFERENCES.density,
    landingView: landingOk(raw.landingView)
      ? raw.landingView
      : DEFAULT_PREFERENCES.landingView,
    emailDigest:
      typeof raw.emailDigest === "boolean"
        ? raw.emailDigest
        : DEFAULT_PREFERENCES.emailDigest,
    onboardingComplete:
      typeof raw.onboardingComplete === "boolean"
        ? raw.onboardingComplete
        : DEFAULT_PREFERENCES.onboardingComplete,
  };
}

// GET /api/preferences — current user's typed UI preferences in the active org.
export const GET = withOrg(async (_req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "viewer");
    const raw = await loadRawPrefs(ctx.org.id, ctx.user.id);
    return ok<Preferences>(projectPreferences(raw));
  } catch (err) {
    const s = statusOf(err);
    return fail(s ? "Forbidden." : "Failed to load preferences.", s ?? 500);
  }
});

// PATCH /api/preferences — update the current user's own preferences. Merges the
// changed keys into the existing prefs jsonb, preserving any unrelated keys.
export const PATCH = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "viewer");
    const json = await req.json().catch(() => null);
    const parsed = updatePreferencesSchema.safeParse(json);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid input.", 400);
    }
    const input = parsed.data;

    const pool = getPool();
    const raw = await loadRawPrefs(ctx.org.id, ctx.user.id);
    const next: Record<string, unknown> = { ...raw };
    if (input.theme !== undefined) next.theme = input.theme;
    if (input.density !== undefined) next.density = input.density;
    if (input.landing_view !== undefined) next.landingView = input.landing_view;
    if (input.email_digest !== undefined) next.emailDigest = input.email_digest;
    if (input.onboarding_complete !== undefined) {
      next.onboardingComplete = input.onboarding_complete;
    }

    await pool.query(
      `insert into user_profiles (org_id, user_id, prefs)
         values ($1, $2, $3)
       on conflict (org_id, user_id) do update set
         prefs = excluded.prefs`,
      [ctx.org.id, ctx.user.id, JSON.stringify(next)]
    );

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "preferences.update",
      entityType: "user_profile",
      entityId: ctx.user.id,
      metadata: { fields: Object.keys(input) },
    });

    return ok<Preferences>(projectPreferences(next));
  } catch (err) {
    const s = statusOf(err);
    return fail(s ? "Forbidden." : "Failed to update preferences.", s ?? 500);
  }
});
