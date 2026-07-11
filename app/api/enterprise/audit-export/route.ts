import { NextRequest } from "next/server";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { requireRole } from "@/lib/authz/rbac";
import { ok } from "@/lib/api/response";
import { getPool } from "@/lib/db";
import { requireFeature, UpgradeRequired } from "@/lib/billing/tiers";
import {
  assembleAuditExport,
  type AuditExport,
  type AuditExportWindow,
} from "@/lib/enterprise/auditExport";

export const runtime = "nodejs";

// GET /api/enterprise/audit-export
//
// Assembles an immutable, verifiable export of the org's WORM audit chain
// (lib/enterprise/auditExport.ts). This route is the FIRST real enforcement of
// the `audit_export` tier gate:
//
//   1. withOrg resolves the org from the session (never client-asserted).
//   2. requireRole(admin) — audit export is an administrative action.
//   3. requireFeature(pool, org, "audit_export") — throws UpgradeRequired for
//      orgs below the Enterprise tier, which we map to HTTP 402 with the
//      feature/currentTier/requiredTiers needed to render an upgrade CTA.
//
// Query params:
//   ?from=<ISO>  ?to=<ISO>   — optional inclusive created_at window.
//   ?format=json             — force a downloadable attachment response.
//
// No LLM anywhere; deterministic assembly. Never logs claim/patient/source text.
export const GET = withOrg(async (req: NextRequest, ctx: Ctx) => {
  // Administrative action: require at least the admin role before doing any work.
  requireRole(ctx, "admin");

  const pool = getPool();

  // Enforce the Enterprise-tier gate BEFORE assembling the export. UpgradeRequired
  // carries only non-sensitive metadata (feature key + tiers), safe to surface.
  try {
    await requireFeature(pool, ctx.org.id, "audit_export");
  } catch (err) {
    if (err instanceof UpgradeRequired) {
      return fail(err.message, 402, {
        feature: err.feature,
        currentTier: err.currentTier,
        requiredTiers: err.requiredTiers,
      });
    }
    return fail("Failed to check audit-export entitlement.", 500);
  }

  const url = new URL(req.url);
  const window: AuditExportWindow = {
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
  };
  const asDownload = url.searchParams.get("format") === "json";

  try {
    const exportDoc = await assembleAuditExport(pool, ctx.org.id, window);

    if (asDownload) {
      return downloadResponse(exportDoc);
    }
    return ok<AuditExport>(exportDoc);
  } catch {
    // Deliberately generic — never echo internal error text (may reference ids).
    return fail("Failed to assemble the audit export.", 500);
  }
});

// A minimal upgrade envelope surfaced with 402 responses so the console can show
// a precise "upgrade to X" CTA. Only non-sensitive tier metadata.
interface UpgradeDetail {
  feature: string;
  currentTier: string;
  requiredTiers: readonly string[];
}

// fail() only carries a message; the console reads these fields off the JSON
// body. We build the envelope explicitly to keep the 402 shape stable.
function failUpgrade(detail: UpgradeDetail, message: string): Response {
  return new Response(
    JSON.stringify({
      success: false,
      data: null,
      error: message,
      upgrade: detail,
    }),
    {
      status: 402,
      headers: { "Content-Type": "application/json" },
    }
  );
}

// Small wrapper so fail(message, 402, detail) reads naturally at the call site
// while still emitting the standard { success, data, error } envelope plus the
// upgrade detail the console needs.
function fail(message: string, status: number, upgrade?: UpgradeDetail): Response {
  if (status === 402 && upgrade) {
    return failUpgrade(upgrade, message);
  }
  const body = { success: false, data: null, error: message };
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Emit the export as a downloadable JSON attachment. The filename embeds the
// (deterministic) export_hash prefix so re-downloads of an unchanged chain are
// self-identifying and de-duplicable.
function downloadResponse(exportDoc: AuditExport): Response {
  const hashPrefix = exportDoc.export_hash.slice(0, 12);
  const filename = `papertrail-audit-export-${hashPrefix}.json`;
  return new Response(JSON.stringify(exportDoc, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
