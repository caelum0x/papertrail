import type { Pool } from "pg";
import type {
  Review,
  ReviewDecision,
  ReviewStatus,
  ReviewWithPeople,
} from "@/lib/reviews/types";

// Data access for reviews. Every method is org-scoped: org_id is always the
// first predicate so a caller can never read or mutate another tenant's rows.

// Raw DB row shape (snake_case), including joined people columns.
interface ReviewRow {
  id: string;
  org_id: string;
  project_id: string | null;
  claim_id: string | null;
  assignee_id: string | null;
  reviewer_id: string | null;
  status: ReviewStatus;
  decision: ReviewDecision | null;
  comment: string | null;
  due_date: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
  assignee_name: string | null;
  assignee_email: string | null;
  reviewer_name: string | null;
  reviewer_email: string | null;
}

function toIso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapRow(row: ReviewRow): ReviewWithPeople {
  return {
    id: row.id,
    orgId: row.org_id,
    projectId: row.project_id,
    claimId: row.claim_id,
    assigneeId: row.assignee_id,
    reviewerId: row.reviewer_id,
    status: row.status,
    decision: row.decision,
    comment: row.comment,
    dueDate: toIso(row.due_date),
    createdAt: toIso(row.created_at) as string,
    updatedAt: toIso(row.updated_at) as string,
    assigneeName: row.assignee_name,
    assigneeEmail: row.assignee_email,
    reviewerName: row.reviewer_name,
    reviewerEmail: row.reviewer_email,
  };
}

const SELECT_WITH_PEOPLE = `
  select r.*,
         a.name  as assignee_name,
         a.email as assignee_email,
         rv.name  as reviewer_name,
         rv.email as reviewer_email
    from reviews r
    left join users a  on a.id  = r.assignee_id
    left join users rv on rv.id = r.reviewer_id
`;

export interface ListReviewsFilters {
  orgId: string;
  scope: "mine" | "all";
  currentUserId: string;
  status?: ReviewStatus;
  limit: number;
  offset: number;
}

export interface CreateReviewData {
  orgId: string;
  projectId: string | null;
  claimId: string | null;
  assigneeId: string | null;
  comment: string | null;
  dueDate: string | null;
}

export interface UpdateReviewData {
  assigneeId?: string | null;
  status?: ReviewStatus;
  comment?: string | null;
  dueDate?: string | null;
}

export async function listReviews(
  pool: Pool,
  filters: ListReviewsFilters
): Promise<{ items: ReviewWithPeople[]; total: number }> {
  const conditions: string[] = ["r.org_id = $1"];
  const params: unknown[] = [filters.orgId];

  if (filters.scope === "mine") {
    params.push(filters.currentUserId);
    conditions.push(`r.assignee_id = $${params.length}`);
  }
  if (filters.status) {
    params.push(filters.status);
    conditions.push(`r.status = $${params.length}`);
  }

  const where = conditions.join(" and ");

  const countResult = await pool.query(
    `select count(*)::int as total from reviews r where ${where}`,
    params
  );
  const total: number = countResult.rows[0]?.total ?? 0;

  const limitParam = params.length + 1;
  const offsetParam = params.length + 2;
  const listResult = await pool.query<ReviewRow>(
    `${SELECT_WITH_PEOPLE}
      where ${where}
      order by
        case when r.status in ('pending','in_review') then 0 else 1 end,
        r.due_date asc nulls last,
        r.created_at desc
      limit $${limitParam} offset $${offsetParam}`,
    [...params, filters.limit, filters.offset]
  );

  return { items: listResult.rows.map(mapRow), total };
}

export async function getReview(
  pool: Pool,
  orgId: string,
  id: string
): Promise<ReviewWithPeople | null> {
  const { rows } = await pool.query<ReviewRow>(
    `${SELECT_WITH_PEOPLE} where r.org_id = $1 and r.id = $2 limit 1`,
    [orgId, id]
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function createReview(
  pool: Pool,
  data: CreateReviewData
): Promise<ReviewWithPeople> {
  const { rows } = await pool.query<{ id: string }>(
    `insert into reviews (org_id, project_id, claim_id, assignee_id, comment, due_date, status)
     values ($1, $2, $3, $4, $5, $6, 'pending')
     returning id`,
    [
      data.orgId,
      data.projectId,
      data.claimId,
      data.assigneeId,
      data.comment,
      data.dueDate,
    ]
  );
  const created = await getReview(pool, data.orgId, rows[0].id);
  // Non-null: we just inserted it under this org.
  return created as ReviewWithPeople;
}

export async function updateReview(
  pool: Pool,
  orgId: string,
  id: string,
  data: UpdateReviewData
): Promise<ReviewWithPeople | null> {
  const sets: string[] = [];
  const params: unknown[] = [];

  if (data.assigneeId !== undefined) {
    params.push(data.assigneeId);
    sets.push(`assignee_id = $${params.length}`);
  }
  if (data.status !== undefined) {
    params.push(data.status);
    sets.push(`status = $${params.length}`);
  }
  if (data.comment !== undefined) {
    params.push(data.comment);
    sets.push(`comment = $${params.length}`);
  }
  if (data.dueDate !== undefined) {
    params.push(data.dueDate);
    sets.push(`due_date = $${params.length}`);
  }

  if (sets.length === 0) {
    return getReview(pool, orgId, id);
  }

  sets.push("updated_at = now()");
  params.push(orgId);
  const orgParam = params.length;
  params.push(id);
  const idParam = params.length;

  const { rowCount } = await pool.query(
    `update reviews set ${sets.join(", ")}
      where org_id = $${orgParam} and id = $${idParam}`,
    params
  );
  if (!rowCount) return null;
  return getReview(pool, orgId, id);
}

// Records a decision. Sets reviewer_id to the acting admin, stamps decision +
// status, and appends the reviewer's comment. Returns null if not found.
export async function decideReview(
  pool: Pool,
  orgId: string,
  id: string,
  reviewerId: string,
  decision: ReviewDecision,
  comment: string | null
): Promise<ReviewWithPeople | null> {
  const status: ReviewStatus = decision === "approved" ? "approved" : "rejected";
  const { rowCount } = await pool.query(
    `update reviews
        set decision = $1,
            status = $2,
            reviewer_id = $3,
            comment = coalesce($4, comment),
            updated_at = now()
      where org_id = $5 and id = $6`,
    [decision, status, reviewerId, comment, orgId, id]
  );
  if (!rowCount) return null;
  return getReview(pool, orgId, id);
}

// Confirms a user is a member of the org (used to validate assignee ids so we
// never assign a review to someone outside the tenant).
export async function isOrgMember(
  pool: Pool,
  orgId: string,
  userId: string
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `select 1 from memberships where org_id = $1 and user_id = $2 limit 1`,
    [orgId, userId]
  );
  return Boolean(rowCount);
}

export type { Review };
