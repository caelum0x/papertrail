import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { withOrg, parsePagination, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { countInvoices, listInvoices } from "@/lib/billing/repository";
import type { Invoice } from "@/lib/billing/types";

export const runtime = "nodejs";

// GET /api/billing/invoices — paginated list of the org's invoices, newest
// first. Any authenticated member can view billing history.
export const GET = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    const pool = getPool();
    const { limit, offset, page } = parsePagination(req);
    const [total, invoices] = await Promise.all([
      countInvoices(pool, ctx.org.id),
      listInvoices(pool, ctx.org.id, limit, offset),
    ]);
    return ok<Invoice[]>(invoices, { total, page, limit });
  } catch (err) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to load invoices.", 500);
  }
});
