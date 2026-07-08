import type { Pool } from "pg";
import { getPool } from "@/lib/db";
import type {
  ClaimStatus,
  CreateClaimInput,
  ListClaimsFilter,
  UpdateClaimInput,
} from "@/lib/claims/schemas";

// Data-access layer for claims. Every query is org-scoped: org_id is always a
// bound parameter, never derived from client input, so one tenant can never read
// or mutate another's claims. Pure-ish: returns new rows, never mutates inputs.

export interface Claim {
  id: string;
  org_id: string;
  project_id: string | null;
  text: string;
  status: ClaimStatus;
  cited_source_url: string | null;
  submitted_by: string | null;
  created_at: string;
  updated_at: string;
}

// A verification row linked to a claim (history). Mirrors the legacy verifications
// table columns the claim detail view needs.
export interface ClaimVerification {
  id: string;
  claim_text: string;
  matched_source_id: string | null;
  discrepancy_type: string | null;
  trust_score: number | null;
  explanation: string | null;
  created_at: string;
}

const CLAIM_COLUMNS = `
  id, org_id, project_id, text, status, cited_source_url,
  submitted_by, created_at, updated_at
`;

interface ListParams {
  orgId: string;
  filter: ListClaimsFilter;
  limit: number;
  offset: number;
}

// Returns a page of claims for an org plus the total count matching the filter.
export async function listClaims(
  params: ListParams,
  pool: Pool = getPool()
): Promise<{ items: Claim[]; total: number }> {
  const { orgId, filter, limit, offset } = params;
  const conditions: string[] = ["org_id = $1"];
  const values: unknown[] = [orgId];

  if (filter.project_id) {
    values.push(filter.project_id);
    conditions.push(`project_id = $${values.length}`);
  }
  if (filter.status) {
    values.push(filter.status);
    conditions.push(`status = $${values.length}`);
  }
  if (filter.q) {
    values.push(`%${filter.q}%`);
    conditions.push(`text ilike $${values.length}`);
  }

  const where = conditions.join(" and ");

  const countResult = await pool.query<{ count: string }>(
    `select count(*)::int as count from claims where ${where}`,
    values
  );
  const total = Number(countResult.rows[0]?.count ?? 0);

  const pageValues = [...values, limit, offset];
  const { rows } = await pool.query<Claim>(
    `select ${CLAIM_COLUMNS}
       from claims
      where ${where}
      order by created_at desc
      limit $${pageValues.length - 1} offset $${pageValues.length}`,
    pageValues
  );

  return { items: rows, total };
}

// Fetches a single claim scoped to its org. Returns null if not found in this org.
export async function getClaim(
  orgId: string,
  id: string,
  pool: Pool = getPool()
): Promise<Claim | null> {
  const { rows } = await pool.query<Claim>(
    `select ${CLAIM_COLUMNS} from claims where org_id = $1 and id = $2`,
    [orgId, id]
  );
  return rows[0] ?? null;
}

interface CreateParams extends CreateClaimInput {
  orgId: string;
  submittedBy: string | null;
}

// Inserts a new claim for an org. Defaults status to 'submitted' when omitted.
export async function createClaim(
  params: CreateParams,
  pool: Pool = getPool()
): Promise<Claim> {
  const { orgId, submittedBy, text, project_id, cited_source_url, status } =
    params;
  const { rows } = await pool.query<Claim>(
    `insert into claims (org_id, project_id, text, status, cited_source_url, submitted_by)
     values ($1, $2, $3, $4, $5, $6)
     returning ${CLAIM_COLUMNS}`,
    [
      orgId,
      project_id ?? null,
      text,
      status ?? "submitted",
      cited_source_url ?? null,
      submittedBy,
    ]
  );
  return rows[0];
}

// Applies a partial update to a claim, org-scoped. Returns the updated row or null
// if the claim does not exist in this org. Builds the SET clause from provided keys.
export async function updateClaim(
  orgId: string,
  id: string,
  input: UpdateClaimInput,
  pool: Pool = getPool()
): Promise<Claim | null> {
  const sets: string[] = [];
  const values: unknown[] = [];

  if (input.text !== undefined) {
    values.push(input.text);
    sets.push(`text = $${values.length}`);
  }
  if (input.project_id !== undefined) {
    values.push(input.project_id);
    sets.push(`project_id = $${values.length}`);
  }
  if (input.cited_source_url !== undefined) {
    values.push(input.cited_source_url);
    sets.push(`cited_source_url = $${values.length}`);
  }
  if (input.status !== undefined) {
    values.push(input.status);
    sets.push(`status = $${values.length}`);
  }

  if (sets.length === 0) {
    // Nothing to update — return the current row unchanged.
    return getClaim(orgId, id, pool);
  }

  sets.push(`updated_at = now()`);
  values.push(orgId);
  const orgParam = values.length;
  values.push(id);
  const idParam = values.length;

  const { rows } = await pool.query<Claim>(
    `update claims set ${sets.join(", ")}
      where org_id = $${orgParam} and id = $${idParam}
      returning ${CLAIM_COLUMNS}`,
    values
  );
  return rows[0] ?? null;
}

// Deletes a claim, org-scoped. Returns true if a row was removed.
export async function deleteClaim(
  orgId: string,
  id: string,
  pool: Pool = getPool()
): Promise<boolean> {
  const result = await pool.query(
    `delete from claims where org_id = $1 and id = $2`,
    [orgId, id]
  );
  return (result.rowCount ?? 0) > 0;
}

// Verification history for a claim, newest first. Linked via verifications.claim_id.
export async function listClaimVerifications(
  claimId: string,
  pool: Pool = getPool()
): Promise<ClaimVerification[]> {
  const { rows } = await pool.query<ClaimVerification>(
    `select id, claim_text, matched_source_id, discrepancy_type,
            trust_score, explanation, created_at
       from verifications
      where claim_id = $1
      order by created_at desc`,
    [claimId]
  );
  return rows;
}
