import { NextRequest } from "next/server";
import { z } from "zod";
import { getPool } from "@/lib/db";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { writeAudit } from "@/lib/audit";

export const runtime = "nodejs";

// The current user's profile within the active org. A user is global but their
// display name / title / avatar / preferences are org-scoped (see migration 0019).
export interface Profile {
  userId: string;
  orgId: string;
  email: string;
  displayName: string | null;
  title: string | null;
  avatarUrl: string | null;
  prefs: Record<string, unknown>;
}

// PATCH accepts any subset of the editable profile fields. Fields are nullable so
// a caller can clear them; omitted fields are left untouched. prefs is merged (not
// replaced) so a partial preferences update doesn't wipe unrelated keys.
const updateProfileSchema = z
  .object({
    display_name: z.string().trim().max(120).nullable().optional(),
    title: z.string().trim().max(120).nullable().optional(),
    avatar_url: z.string().trim().url().max(2048).nullable().optional(),
    prefs: z.record(z.unknown()).optional(),
  })
  .strict();

function statusOf(err: unknown): number | null {
  if (err instanceof Error && "status" in err) {
    return (err as { status: number }).status;
  }
  return null;
}

// Loads the profile row, creating a lazy default if none exists yet. Always
// org-scoped AND user-scoped. Returns the merged view including the user's email.
async function loadProfile(orgId: string, user: Ctx["user"]): Promise<Profile> {
  const pool = getPool();
  const { rows } = await pool.query(
    `select display_name, title, avatar_url, prefs
       from user_profiles
      where org_id = $1 and user_id = $2
      limit 1`,
    [orgId, user.id]
  );
  const row = rows[0];
  return {
    userId: user.id,
    orgId,
    email: user.email,
    displayName: row?.display_name ?? null,
    title: row?.title ?? null,
    avatarUrl: row?.avatar_url ?? null,
    prefs: (row?.prefs as Record<string, unknown>) ?? {},
  };
}

// GET /api/profile — current user's profile + prefs in the active org. Any member.
export const GET = withOrg(async (_req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "viewer");
    const profile = await loadProfile(ctx.org.id, ctx.user);
    return ok<Profile>(profile);
  } catch (err) {
    const s = statusOf(err);
    return fail(s ? "Forbidden." : "Failed to load profile.", s ?? 500);
  }
});

// PATCH /api/profile — update the current user's own profile in the active org.
// A member may always edit their own profile (viewer+); this is not an org-admin
// action. prefs is deep-merged at the top level so partial updates are safe.
export const PATCH = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "viewer");
    const json = await req.json().catch(() => null);
    const parsed = updateProfileSchema.safeParse(json);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid input.", 400);
    }
    const input = parsed.data;

    const pool = getPool();
    const current = await loadProfile(ctx.org.id, ctx.user);
    const mergedPrefs =
      input.prefs === undefined
        ? current.prefs
        : { ...current.prefs, ...input.prefs };
    const displayName =
      input.display_name === undefined ? current.displayName : input.display_name;
    const title = input.title === undefined ? current.title : input.title;
    const avatarUrl =
      input.avatar_url === undefined ? current.avatarUrl : input.avatar_url;

    await pool.query(
      `insert into user_profiles (org_id, user_id, display_name, title, avatar_url, prefs)
         values ($1, $2, $3, $4, $5, $6)
       on conflict (org_id, user_id) do update set
         display_name = excluded.display_name,
         title = excluded.title,
         avatar_url = excluded.avatar_url,
         prefs = excluded.prefs`,
      [
        ctx.org.id,
        ctx.user.id,
        displayName,
        title,
        avatarUrl,
        JSON.stringify(mergedPrefs),
      ]
    );

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "profile.update",
      entityType: "user_profile",
      entityId: ctx.user.id,
      metadata: {
        fields: Object.keys(input),
      },
    });

    const updated = await loadProfile(ctx.org.id, ctx.user);
    return ok<Profile>(updated);
  } catch (err) {
    const s = statusOf(err);
    return fail(s ? "Forbidden." : "Failed to update profile.", s ?? 500);
  }
});
