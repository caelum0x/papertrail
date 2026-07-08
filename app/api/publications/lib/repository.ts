import type { Pool } from "pg";
import type {
  MlrDecision,
  MlrReview,
  MlrRole,
  Publication,
  PublicationClaim,
  PublicationClaimStatus,
  PublicationReadiness,
  PublicationStage,
  PublicationStatus,
  PublicationType,
  PublicationWithCounts,
} from "./types";
import { MLR_ROLES } from "./schemas";

// Data access for the publication-planning module. Every method is org-scoped:
// org_id is always the first predicate so a caller can never read or mutate
// another tenant's rows.

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

// --- publications --------------------------------------------------------

interface PublicationRow {
  id: string;
  org_id: string;
  project_id: string | null;
  title: string;
  type: PublicationType;
  target_journal: string | null;
  status: PublicationStatus;
  stage: PublicationStage;
  created_by: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

function mapPublication(row: PublicationRow): Publication {
  return {
    id: row.id,
    orgId: row.org_id,
    projectId: row.project_id,
    title: row.title,
    type: row.type,
    targetJournal: row.target_journal,
    status: row.status,
    stage: row.stage,
    createdBy: row.created_by,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

interface PublicationCountRow extends PublicationRow {
  claim_count: number | string;
  verified_count: number | string;
}

function mapPublicationWithCounts(row: PublicationCountRow): PublicationWithCounts {
  return {
    ...mapPublication(row),
    claimCount: Number(row.claim_count) || 0,
    verifiedCount: Number(row.verified_count) || 0,
  };
}

// Attached-claim counts: total attached (not removed) and how many are backed by
// a claim whose latest verification is accurate.
const SELECT_PUBLICATION_WITH_COUNTS = `
  select p.*,
         (select count(*) from publication_claims pc
            where pc.publication_id = p.id and pc.status <> 'removed') as claim_count,
         (select count(*) from publication_claims pc
            join claims c on c.id = pc.claim_id and c.org_id = p.org_id
            where pc.publication_id = p.id and pc.status <> 'removed'
              and c.status = 'verified') as verified_count
    from publications p
`;

export interface ListPublicationsFilters {
  orgId: string;
  status?: PublicationStatus;
  limit: number;
  offset: number;
}

export async function listPublications(
  pool: Pool,
  filters: ListPublicationsFilters
): Promise<{ items: PublicationWithCounts[]; total: number }> {
  const conditions: string[] = ["p.org_id = $1"];
  const params: unknown[] = [filters.orgId];

  if (filters.status) {
    params.push(filters.status);
    conditions.push(`p.status = $${params.length}`);
  }
  const where = conditions.join(" and ");

  const countResult = await pool.query<{ total: number }>(
    `select count(*)::int as total from publications p where ${where}`,
    params
  );
  const total = countResult.rows[0]?.total ?? 0;

  const listResult = await pool.query<PublicationCountRow>(
    `${SELECT_PUBLICATION_WITH_COUNTS}
      where ${where}
      order by p.created_at desc
      limit $${params.length + 1} offset $${params.length + 2}`,
    [...params, filters.limit, filters.offset]
  );

  return { items: listResult.rows.map(mapPublicationWithCounts), total };
}

export interface CreatePublicationData {
  orgId: string;
  projectId: string | null;
  title: string;
  type: PublicationType;
  targetJournal: string | null;
  createdBy: string | null;
}

export async function createPublication(
  pool: Pool,
  data: CreatePublicationData
): Promise<PublicationWithCounts> {
  const { rows } = await pool.query<{ id: string }>(
    `insert into publications
       (org_id, project_id, title, type, target_journal, created_by)
     values ($1, $2, $3, $4, $5, $6)
     returning id`,
    [
      data.orgId,
      data.projectId,
      data.title,
      data.type,
      data.targetJournal,
      data.createdBy,
    ]
  );
  const created = await getPublication(pool, data.orgId, rows[0].id);
  return created as PublicationWithCounts;
}

export async function getPublication(
  pool: Pool,
  orgId: string,
  id: string
): Promise<PublicationWithCounts | null> {
  const { rows } = await pool.query<PublicationCountRow>(
    `${SELECT_PUBLICATION_WITH_COUNTS} where p.org_id = $1 and p.id = $2 limit 1`,
    [orgId, id]
  );
  return rows[0] ? mapPublicationWithCounts(rows[0]) : null;
}

export interface UpdatePublicationData {
  title?: string;
  type?: PublicationType;
  targetJournal?: string | null;
  status?: PublicationStatus;
  stage?: PublicationStage;
}

export async function updatePublication(
  pool: Pool,
  orgId: string,
  id: string,
  data: UpdatePublicationData
): Promise<PublicationWithCounts | null> {
  const sets: string[] = [];
  const params: unknown[] = [];

  if (data.title !== undefined) {
    params.push(data.title);
    sets.push(`title = $${params.length}`);
  }
  if (data.type !== undefined) {
    params.push(data.type);
    sets.push(`type = $${params.length}`);
  }
  if (data.targetJournal !== undefined) {
    params.push(data.targetJournal);
    sets.push(`target_journal = $${params.length}`);
  }
  if (data.status !== undefined) {
    params.push(data.status);
    sets.push(`status = $${params.length}`);
  }
  if (data.stage !== undefined) {
    params.push(data.stage);
    sets.push(`stage = $${params.length}`);
  }

  if (sets.length === 0) {
    return getPublication(pool, orgId, id);
  }

  sets.push("updated_at = now()");
  params.push(orgId);
  const orgParam = params.length;
  params.push(id);
  const idParam = params.length;

  const { rowCount } = await pool.query(
    `update publications set ${sets.join(", ")}
      where org_id = $${orgParam} and id = $${idParam}`,
    params
  );
  if (!rowCount) return null;
  return getPublication(pool, orgId, id);
}

// --- publication_claims --------------------------------------------------

interface PublicationClaimRow {
  id: string;
  org_id: string;
  publication_id: string;
  claim_id: string;
  status: PublicationClaimStatus;
  created_at: Date | string;
  claim_text: string | null;
  claim_status: string | null;
  discrepancy_type: string | null;
  trust_score: number | string | null;
}

function mapPublicationClaim(row: PublicationClaimRow): PublicationClaim {
  return {
    id: row.id,
    orgId: row.org_id,
    publicationId: row.publication_id,
    claimId: row.claim_id,
    status: row.status,
    createdAt: toIso(row.created_at),
    claimText: row.claim_text,
    claimStatus: row.claim_status,
    discrepancyType: row.discrepancy_type,
    trustScore: row.trust_score == null ? null : Number(row.trust_score),
  };
}

// Joins each attachment to its underlying claim and that claim's latest
// verification (by created_at) so the plan view can render verification state
// without a second round trip.
const SELECT_PUBLICATION_CLAIMS = `
  select pc.*,
         c.text as claim_text,
         c.status as claim_status,
         v.discrepancy_type as discrepancy_type,
         v.trust_score as trust_score
    from publication_claims pc
    left join claims c on c.id = pc.claim_id and c.org_id = pc.org_id
    left join lateral (
      select discrepancy_type, trust_score
        from verifications
       where claim_id = pc.claim_id
       order by created_at desc
       limit 1
    ) v on true
`;

export async function listPublicationClaims(
  pool: Pool,
  orgId: string,
  publicationId: string
): Promise<PublicationClaim[]> {
  const { rows } = await pool.query<PublicationClaimRow>(
    `${SELECT_PUBLICATION_CLAIMS}
      where pc.org_id = $1 and pc.publication_id = $2
      order by pc.created_at desc`,
    [orgId, publicationId]
  );
  return rows.map(mapPublicationClaim);
}

// Attaches claims to a publication. Only claims that exist in the same org are
// attached; unknown/foreign claim ids are skipped. Re-attaching an already
// attached claim is a no-op (unique index). Returns counts for the caller.
export async function attachClaims(
  pool: Pool,
  orgId: string,
  publicationId: string,
  claimIds: string[]
): Promise<{ attached: number; skipped: number }> {
  // Restrict to claims the org actually owns to avoid cross-tenant attachment.
  const validResult = await pool.query<{ id: string }>(
    `select id from claims where org_id = $1 and id = any($2::uuid[])`,
    [orgId, claimIds]
  );
  const validIds = validResult.rows.map((r) => r.id);

  let attached = 0;
  for (const claimId of validIds) {
    const { rowCount } = await pool.query(
      `insert into publication_claims (org_id, publication_id, claim_id)
       values ($1, $2, $3)
       on conflict (publication_id, claim_id) do nothing`,
      [orgId, publicationId, claimId]
    );
    attached += rowCount ?? 0;
  }
  return { attached, skipped: claimIds.length - attached };
}

// --- mlr_reviews ---------------------------------------------------------

interface MlrReviewRow {
  id: string;
  org_id: string;
  publication_id: string;
  reviewer_id: string | null;
  role: MlrRole;
  decision: MlrDecision;
  comments: string | null;
  created_at: Date | string;
}

function mapMlrReview(row: MlrReviewRow): MlrReview {
  return {
    id: row.id,
    orgId: row.org_id,
    publicationId: row.publication_id,
    reviewerId: row.reviewer_id,
    role: row.role,
    decision: row.decision,
    comments: row.comments,
    createdAt: toIso(row.created_at),
  };
}

export interface CreateMlrReviewData {
  orgId: string;
  publicationId: string;
  reviewerId: string | null;
  role: MlrRole;
  decision: MlrDecision;
  comments: string | null;
}

export async function createMlrReview(
  pool: Pool,
  data: CreateMlrReviewData
): Promise<MlrReview> {
  const { rows } = await pool.query<MlrReviewRow>(
    `insert into mlr_reviews
       (org_id, publication_id, reviewer_id, role, decision, comments)
     values ($1, $2, $3, $4, $5, $6)
     returning *`,
    [
      data.orgId,
      data.publicationId,
      data.reviewerId,
      data.role,
      data.decision,
      data.comments,
    ]
  );
  return mapMlrReview(rows[0]);
}

export async function listMlrReviews(
  pool: Pool,
  orgId: string,
  publicationId: string
): Promise<MlrReview[]> {
  const { rows } = await pool.query<MlrReviewRow>(
    `select * from mlr_reviews
      where org_id = $1 and publication_id = $2
      order by created_at desc`,
    [orgId, publicationId]
  );
  return rows.map(mapMlrReview);
}

// The latest decision per MLR role (null if a role has not reviewed yet).
async function latestMlrByRole(
  pool: Pool,
  orgId: string,
  publicationId: string
): Promise<{ role: MlrRole; decision: MlrDecision | null }[]> {
  const { rows } = await pool.query<{ role: MlrRole; decision: MlrDecision }>(
    `select distinct on (role) role, decision
       from mlr_reviews
      where org_id = $1 and publication_id = $2
      order by role, created_at desc`,
    [orgId, publicationId]
  );
  const byRole = new Map<MlrRole, MlrDecision>();
  for (const row of rows) {
    byRole.set(row.role, row.decision);
  }
  return MLR_ROLES.map((role) => ({
    role,
    decision: byRole.get(role) ?? null,
  }));
}

// --- readiness -----------------------------------------------------------

// Computes how ready a publication is: of the claims attached (excluding removed),
// how many are verified & accurate vs. flagged vs. still unverified, plus the
// current MLR sign-off per role. A publication is "ready" when it has at least
// one included claim, every included claim is verified & accurate, and no MLR
// role has rejected or requested changes.
export async function getReadiness(
  pool: Pool,
  orgId: string,
  publicationId: string
): Promise<PublicationReadiness> {
  const { rows } = await pool.query<{
    status: PublicationClaimStatus;
    claim_status: string | null;
    discrepancy_type: string | null;
  }>(
    `select pc.status,
            c.status as claim_status,
            v.discrepancy_type as discrepancy_type
       from publication_claims pc
       left join claims c on c.id = pc.claim_id and c.org_id = pc.org_id
       left join lateral (
         select discrepancy_type
           from verifications
          where claim_id = pc.claim_id
          order by created_at desc
          limit 1
       ) v on true
      where pc.org_id = $1 and pc.publication_id = $2`,
    [orgId, publicationId]
  );

  const active = rows.filter((r) => r.status !== "removed");
  const included = active.filter((r) => r.status === "included");

  const totalClaims = active.length;
  const includedClaims = included.length;

  const isVerified = (r: { claim_status: string | null }): boolean =>
    r.claim_status === "verified";
  const isAccurate = (r: { discrepancy_type: string | null }): boolean =>
    r.discrepancy_type === "accurate";
  const isFlagged = (r: {
    claim_status: string | null;
    discrepancy_type: string | null;
  }): boolean =>
    r.claim_status === "flagged" ||
    (r.discrepancy_type != null && r.discrepancy_type !== "accurate");

  const verifiedClaims = active.filter(isVerified).length;
  const accurateClaims = active.filter(isAccurate).length;
  const flaggedClaims = active.filter(isFlagged).length;
  const unverifiedClaims = active.filter(
    (r) => !isVerified(r) && !isFlagged(r)
  ).length;

  const mlrStatus = await latestMlrByRole(pool, orgId, publicationId);

  const allIncludedAccurate =
    includedClaims > 0 &&
    included.every((r) => isVerified(r) && isAccurate(r));
  const noBlockingMlr = mlrStatus.every(
    (m) => m.decision !== "rejected" && m.decision !== "changes_requested"
  );

  return {
    totalClaims,
    includedClaims,
    verifiedClaims,
    accurateClaims,
    flaggedClaims,
    unverifiedClaims,
    ready: allIncludedAccurate && noBlockingMlr,
    mlrStatus,
  };
}
