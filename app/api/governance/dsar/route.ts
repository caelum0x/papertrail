import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { getPool } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { requireRole } from "@/lib/authz/rbac";
import { assembleDsarExport, type DsarExport } from "@/lib/governance/dsar";

// DSAR (Data Subject Access Request) API. POST a subject email and get back the
// org-scoped package of everything PaperTrail holds about that person (counts +
// non-secret records). Admin-only governance action. ?format=json returns the
// same package as a downloadable attachment.
export const runtime = "nodejs";

function rbacStatus(err: unknown): number | null {
  if (
    err instanceof Error &&
    typeof (err as unknown as { status?: unknown }).status === "number"
  ) {
    return (err as unknown as { status: number }).status;
  }
  return null;
}

const dsarSchema = z.object({
  subjectEmail: z
    .string()
    .trim()
    .min(3, "Provide the data subject's email.")
    .max(320)
    .email("Provide a valid email address."),
});

// A safe, filesystem-friendly filename fragment for the download. We never embed
// the raw email in a header verbatim; a short hash-free slug keeps PII out of the
// attachment name while staying human-recognizable by local-part.
function downloadSlug(email: string): string {
  const local = email.split("@")[0] ?? "subject";
  const safe = local.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase();
  return safe.length ? safe : "subject";
}

// POST /api/governance/dsar — assemble a DSAR package for { subjectEmail }.
// With ?format=json the package is returned as a downloadable JSON attachment;
// otherwise it is returned in the standard { success, data } envelope. Admin-only.
export const POST = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "admin");

    const body = await req.json().catch(() => null);
    const parsed = dsarSchema.safeParse(body);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid DSAR request.", 400);
    }

    const pkg = await assembleDsarExport(getPool(), ctx.org.id, {
      subjectEmail: parsed.data.subjectEmail,
    });

    await writeAudit(getPool(), {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "dsar.assemble",
      entityType: "dsar_export",
      entityId: pkg.subject?.userId ?? null,
      // Counts + flags only — never the subject email or any record contents.
      metadata: {
        found: pkg.found,
        memberships: pkg.counts.memberships,
        audit_entries: pkg.counts.auditEntries,
        api_keys: pkg.counts.apiKeys,
      },
    });

    const url = new URL(req.url);
    if (url.searchParams.get("format") === "json") {
      const filename = `dsar-${downloadSlug(parsed.data.subjectEmail)}-${ctx.org.slug}.json`;
      return new NextResponse(JSON.stringify(pkg, null, 2), {
        status: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Cache-Control": "no-store",
        },
      });
    }

    return ok<DsarExport>(pkg);
  } catch (err: unknown) {
    const status = rbacStatus(err);
    if (status !== null) {
      return fail((err as Error).message, status);
    }
    return fail("Couldn't assemble the DSAR export. Please try again.", 500);
  }
});
