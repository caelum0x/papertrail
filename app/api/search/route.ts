import { NextRequest } from "next/server";
import { z } from "zod";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { getPool } from "@/lib/db";
import {
  SEARCH_TYPES,
  SEARCH_TYPE_LABELS,
  type SearchType,
  type SearchResult,
  type SearchGroup,
  type SearchResponse,
} from "@/components/search/types";

export const runtime = "nodejs";

// Max results returned per entity type. Keeps the palette snappy and the query
// bounded regardless of how large the org's data set is.
const PER_TYPE_LIMIT = 8;

const querySchema = z.object({
  q: z.string().trim().min(1, "Enter a search term.").max(200),
  type: z.enum(SEARCH_TYPES).optional(),
});

// Escapes LIKE wildcards so user input is treated literally, then wraps in
// %...% for a contains match. Pair with `like ... escape '\'` in SQL.
function likePattern(raw: string): string {
  const escaped = raw.replace(/[\\%_]/g, (ch) => `\\${ch}`);
  return `%${escaped}%`;
}

// Truncates a body-text match to a short single-line snippet for display.
function snippet(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const collapsed = value.replace(/\s+/g, " ").trim();
  if (collapsed.length === 0) {
    return null;
  }
  return collapsed.length > 160 ? `${collapsed.slice(0, 157)}...` : collapsed;
}

async function searchClaims(
  orgId: string,
  pattern: string
): Promise<SearchResult[]> {
  const { rows } = await getPool().query(
    `select id, text, created_at
       from claims
      where org_id = $1
        and text ilike $2 escape '\\'
      order by created_at desc
      limit $3`,
    [orgId, pattern, PER_TYPE_LIMIT]
  );
  return rows.map((row) => ({
    id: row.id,
    type: "claim" as const,
    title: snippet(row.text) ?? "Untitled claim",
    snippet: null,
    href: `/console/claims/${row.id}`,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
  }));
}

async function searchDocuments(
  orgId: string,
  pattern: string
): Promise<SearchResult[]> {
  const { rows } = await getPool().query(
    `select id, filename, extracted_text, created_at
       from documents
      where org_id = $1
        and (filename ilike $2 escape '\\' or extracted_text ilike $2 escape '\\')
      order by created_at desc
      limit $3`,
    [orgId, pattern, PER_TYPE_LIMIT]
  );
  return rows.map((row) => ({
    id: row.id,
    type: "document" as const,
    title: row.filename ?? "Untitled document",
    snippet: snippet(row.extracted_text),
    href: `/console/documents/${row.id}`,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
  }));
}

async function searchEvidence(
  orgId: string,
  pattern: string
): Promise<SearchResult[]> {
  const { rows } = await getPool().query(
    `select id, title, created_at
       from evidence_items
      where org_id = $1
        and title ilike $2 escape '\\'
      order by created_at desc
      limit $3`,
    [orgId, pattern, PER_TYPE_LIMIT]
  );
  return rows.map((row) => ({
    id: row.id,
    type: "evidence" as const,
    title: row.title ?? "Untitled evidence",
    snippet: null,
    href: `/console/evidence/${row.id}`,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
  }));
}

// Verifications have no org_id of their own; they are scoped to the org by
// joining through the owning claim (claim_id -> claims.org_id). Verifications
// with no owning claim are intentionally excluded from org-scoped search.
async function searchVerifications(
  orgId: string,
  pattern: string
): Promise<SearchResult[]> {
  const { rows } = await getPool().query(
    `select v.id, v.claim_text, v.created_at
       from verifications v
       join claims c on c.id = v.claim_id
      where c.org_id = $1
        and v.claim_text ilike $2 escape '\\'
      order by v.created_at desc
      limit $3`,
    [orgId, pattern, PER_TYPE_LIMIT]
  );
  return rows.map((row) => ({
    id: row.id,
    type: "verification" as const,
    title: snippet(row.claim_text) ?? "Verification",
    snippet: null,
    href: `/console/analytics/verifications`,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
  }));
}

const SEARCHERS: Record<
  SearchType,
  (orgId: string, pattern: string) => Promise<SearchResult[]>
> = {
  claim: searchClaims,
  document: searchDocuments,
  evidence: searchEvidence,
  verification: searchVerifications,
};

// GET /api/search?q=&type= — org-scoped global search across claims, documents,
// evidence, and verifications. Optional `type` narrows to a single entity kind.
// Read-only: any org member (viewer+) may search.
export const GET = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    const url = new URL(req.url);
    const parsed = querySchema.safeParse({
      q: url.searchParams.get("q") ?? "",
      type: url.searchParams.get("type") ?? undefined,
    });
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid search query.", 400);
    }

    const { q, type } = parsed.data;
    const pattern = likePattern(q);
    const typesToSearch: readonly SearchType[] = type ? [type] : SEARCH_TYPES;

    const settled = await Promise.all(
      typesToSearch.map((t) => SEARCHERS[t](ctx.org.id, pattern))
    );

    const groups: SearchGroup[] = typesToSearch
      .map((t, i) => ({
        type: t,
        label: SEARCH_TYPE_LABELS[t],
        results: settled[i],
      }))
      .filter((group) => group.results.length > 0);

    const total = groups.reduce((sum, g) => sum + g.results.length, 0);

    const response: SearchResponse = { query: q, total, groups };
    return ok(response);
  } catch {
    return fail("Couldn't run the search. Please try again.", 500);
  }
});
