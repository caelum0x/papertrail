import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { writeAudit } from "@/lib/audit";
import { domainVerificationToken } from "@/lib/sso/config";
import { getConnectionRaw, updateConnection } from "@/lib/sso/repository";
import type { DomainVerifyResult } from "@/lib/sso/types";

export const runtime = "nodejs";

// POST /api/sso-connections/[id]/verify-domain — attempt DNS TXT domain
// ownership verification. The admin publishes the returned token as a TXT record
// on the connection's domain; we resolve it via DNS-over-HTTPS and, on a match,
// mark the connection verified (which unlocks activation). Admin+ only.
//
// This uses Cloudflare's public DNS-over-HTTPS resolver so it works from the
// serverless runtime without a raw DNS socket. If lookup fails or the token is
// absent, we return an unverified result with the exact record to publish —
// never a false "verified".
export const POST = withOrg(async (_req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "admin");
    const id = params?.id;
    if (!id) return fail("Connection id is required.", 400);

    const pool = getPool();
    const existing = await getConnectionRaw(pool, ctx.org.id, id);
    if (!existing) return fail("SSO connection not found.", 404);

    const domain = existing.domain;
    if (!domain) {
      return fail("Set a domain on this connection before verifying.", 400);
    }

    const token = domainVerificationToken(id, domain);
    const verified = await checkDnsTxt(domain, token);

    if (verified && !existing.verified) {
      await updateConnection(pool, ctx.org.id, id, { verified: true });
    }

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "sso_connection.verify_domain",
      entityType: "sso_connection",
      entityId: id,
      metadata: { domain, verified },
    });

    const result: DomainVerifyResult = {
      verified,
      domain,
      token,
      detail: verified
        ? "Domain ownership verified. You can now activate this connection."
        : "TXT record not found yet. Add the record below and try again — DNS can take a few minutes to propagate.",
    };
    return ok<DomainVerifyResult>(result);
  } catch (err) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to verify domain.", 500);
  }
});

// Resolves TXT records for a domain via DNS-over-HTTPS and checks for an exact
// token match. Returns false (never throws) on any resolver/network error so a
// failed lookup is an honest "not verified", not a crash.
async function checkDnsTxt(domain: string, token: string): Promise<boolean> {
  try {
    const res = await fetch(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(
        domain
      )}&type=TXT`,
      { headers: { Accept: "application/dns-json" }, cache: "no-store" }
    );
    if (!res.ok) return false;
    const body = (await res.json().catch(() => null)) as {
      Answer?: { data?: string }[];
    } | null;
    const answers = body?.Answer ?? [];
    return answers.some((a) => {
      const data = (a.data ?? "").replace(/^"|"$/g, "");
      return data === token;
    });
  } catch {
    return false;
  }
}
