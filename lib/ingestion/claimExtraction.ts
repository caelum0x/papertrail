import { z } from "zod";
import type { Pool } from "pg";
import { callClaudeForJson } from "@/lib/claude";

// Pulls candidate verifiable claims out of a document's text using Claude, and
// persists them to document_claims. A "verifiable claim" here is a self-contained
// sentence asserting a quantitative or efficacy finding that could be checked
// against a primary source (e.g. "Drug X reduced events by 30%"). We deliberately
// over-recall slightly and let the user promote/dismiss — a candidate that turns
// out unverifiable is cheap; a missed claim is not.

// Deterministic schema for the LLM output. Every claim maps to an optional page.
export const candidateClaimSchema = z.object({
  text: z.string().trim().min(1).max(2000),
  page_number: z.number().int().min(1).nullable().optional(),
});

export const claimExtractionSchema = z.object({
  claims: z.array(candidateClaimSchema).max(50),
});

export type CandidateClaim = z.infer<typeof candidateClaimSchema>;

export type DocumentClaimStatus = "candidate" | "promoted" | "dismissed";
export type DocumentClaimSource = "llm" | "manual";

export interface DocumentClaim {
  id: string;
  document_id: string;
  page_number: number | null;
  text: string;
  extracted_by: DocumentClaimSource;
  status: DocumentClaimStatus;
  created_at: string;
}

const SYSTEM_PROMPT = `You are a scientific claims extraction assistant for a
clinical-evidence verification tool. Given the text of a research paper or trial
record, identify the specific, checkable EFFICACY / OUTCOME claims it makes —
statements that assert a quantitative result or a cause-effect finding that could
be verified against a primary source.

Rules:
- Extract ONLY claims explicitly stated in the text. Never infer or generalize.
- Prefer claims with a magnitude, comparator, population, or endpoint
  (e.g. "reduced cardiovascular events by 30% vs placebo in adults with T2D").
- Ignore background, methods boilerplate, funding, and vague statements.
- Each claim must be a single self-contained sentence, quoted or lightly trimmed
  from the source — do not merge multiple findings into one.
- If a page number is evident from the provided text markers, include it; else null.
- Return AT MOST 25 of the strongest claims.

Respond with ONLY a single JSON object, no other text:
{ "claims": [ { "text": string, "page_number": number | null } ] }`;

// Character budget for the prompt. Documents can be hundreds of pages, so we cap
// the text sent to Claude to control token spend; callers pass the most relevant
// slice (e.g. abstract + results) or the leading portion for a first pass.
const MAX_INPUT_CHARS = 14000;

function toDocumentClaim(row: Record<string, unknown>): DocumentClaim {
  return {
    id: String(row.id),
    document_id: String(row.document_id),
    page_number:
      row.page_number === null || row.page_number === undefined
        ? null
        : Number(row.page_number),
    text: String(row.text),
    extracted_by: String(row.extracted_by) as DocumentClaimSource,
    status: String(row.status) as DocumentClaimStatus,
    created_at: new Date(row.created_at as string).toISOString(),
  };
}

/**
 * Extracts candidate verifiable claims from raw document text. Returns the parsed
 * (zod-validated) candidate list — persistence is the caller's responsibility so
 * this stays a pure, testable transform. Empty text yields an empty list without
 * spending an API call.
 */
export async function extractClaimsFromText(
  text: string
): Promise<CandidateClaim[]> {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return [];
  }

  const result = await callClaudeForJson({
    system: SYSTEM_PROMPT,
    user: `Document text:\n\n${trimmed.slice(0, MAX_INPUT_CHARS)}`,
    schema: claimExtractionSchema,
    maxTokens: 2000,
  });

  return result.claims;
}

// Replaces any existing LLM-extracted candidates for a document with a fresh set.
// Manual claims (extracted_by = 'manual') and already-promoted claims are left
// untouched so a re-run never destroys user decisions.
export async function replaceLlmClaims(
  pool: Pool,
  orgId: string,
  documentId: string,
  claims: CandidateClaim[]
): Promise<DocumentClaim[]> {
  await pool.query(
    `delete from document_claims
      where org_id = $1 and document_id = $2
        and extracted_by = 'llm' and status = 'candidate'`,
    [orgId, documentId]
  );

  const inserted: DocumentClaim[] = [];
  for (const claim of claims) {
    const res = await pool.query(
      `insert into document_claims
         (org_id, document_id, page_number, text, extracted_by, status)
       values ($1, $2, $3, $4, 'llm', 'candidate')
       returning id, document_id, page_number, text, extracted_by, status, created_at`,
      [orgId, documentId, claim.page_number ?? null, claim.text]
    );
    inserted.push(toDocumentClaim(res.rows[0]));
  }
  return inserted;
}

export async function listDocumentClaims(
  pool: Pool,
  orgId: string,
  documentId: string,
  opts: { limit: number; offset: number }
): Promise<{ claims: DocumentClaim[]; total: number }> {
  const countRes = await pool.query(
    `select count(*)::int as total from document_claims
      where org_id = $1 and document_id = $2`,
    [orgId, documentId]
  );
  const total = Number(countRes.rows[0]?.total ?? 0);

  const rowsRes = await pool.query(
    `select id, document_id, page_number, text, extracted_by, status, created_at
       from document_claims
      where org_id = $1 and document_id = $2
      order by created_at asc
      limit $3 offset $4`,
    [orgId, documentId, opts.limit, opts.offset]
  );
  return { claims: rowsRes.rows.map(toDocumentClaim), total };
}
