import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { getPool } from "@/lib/db";

// Data access + validation for onboarding & workspace setup (migration 0046).
// Colocated with the onboarding routes so the module owns its persistence. Every
// query binds org_id (and user_id where relevant) as a parameter — a tenant can
// never read or mutate another org's onboarding progress.

// ---------------------------------------------------------------------------
// Step vocabulary — the fixed set of wizard steps. Kept bounded so a client can
// never mark an arbitrary step complete. Adding a step here (not a migration)
// extends the wizard because `steps` is a jsonb map.
// ---------------------------------------------------------------------------

export const STEP_IDS = [
  "welcome",
  "workspace",
  "invite",
  "sample_data",
  "finish",
] as const;

export type StepId = (typeof STEP_IDS)[number];

export interface StepMeta {
  id: StepId;
  title: string;
  blurb: string;
  // If true, finishing onboarding does not require this step (optional/skippable).
  optional: boolean;
}

// Source of truth for the wizard + checklist. The final step ("finish") flips the
// denormalized `completed` flag; the others are progress markers.
export const STEP_META: readonly StepMeta[] = [
  {
    id: "welcome",
    title: "Welcome",
    blurb: "A quick tour of what PaperTrail does and how the wizard works.",
    optional: false,
  },
  {
    id: "workspace",
    title: "Name your workspace",
    blurb: "Confirm the organization your claims, sources, and reports live in.",
    optional: false,
  },
  {
    id: "invite",
    title: "Invite your team",
    blurb: "Bring in collaborators to review and verify claims together.",
    optional: true,
  },
  {
    id: "sample_data",
    title: "Load sample data",
    blurb: "Seed a demo project and claim so you can explore a real trail.",
    optional: true,
  },
  {
    id: "finish",
    title: "Finish setup",
    blurb: "Wrap up and head into your workspace.",
    optional: false,
  },
];

const STEP_ID_SET = new Set<string>(STEP_IDS);

function isStepId(value: string): value is StepId {
  return STEP_ID_SET.has(value);
}

// ---------------------------------------------------------------------------
// Zod schemas — never trust raw client JSON.
// ---------------------------------------------------------------------------

export const completeStepSchema = z.object({
  step: z
    .string()
    .refine((v): v is StepId => isStepId(v), "Unknown onboarding step."),
});

export type CompleteStepInput = z.infer<typeof completeStepSchema>;

// ---------------------------------------------------------------------------
// Types + mappers
// ---------------------------------------------------------------------------

// steps jsonb is a map of stepId -> ISO timestamp string when it was completed.
export type StepMap = Partial<Record<StepId, string>>;

export interface OnboardingState {
  id: string;
  org_id: string;
  user_id: string;
  steps: StepMap;
  completed: boolean;
  created_at: string;
}

export interface ChecklistItem {
  id: StepId;
  title: string;
  blurb: string;
  optional: boolean;
  done: boolean;
  completed_at: string | null;
}

export interface Checklist {
  items: ChecklistItem[];
  completed: boolean;
  required_total: number;
  required_done: number;
  percent: number;
}

interface OnboardingRow {
  id: string;
  org_id: string;
  user_id: string;
  steps: unknown;
  completed: boolean;
  created_at: Date | string;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

// Coerce the raw jsonb into a validated StepMap — drop any unknown keys or
// non-string values so downstream code can trust the shape.
function mapSteps(raw: unknown): StepMap {
  if (typeof raw !== "object" || raw === null) {
    return {};
  }
  const out: StepMap = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (isStepId(key) && typeof value === "string") {
      out[key] = value;
    }
  }
  return out;
}

function mapState(row: OnboardingRow): OnboardingState {
  return {
    id: row.id,
    org_id: row.org_id,
    user_id: row.user_id,
    steps: mapSteps(row.steps),
    completed: row.completed,
    created_at: toIso(row.created_at),
  };
}

// ---------------------------------------------------------------------------
// State access
// ---------------------------------------------------------------------------

// Returns the caller's onboarding row, creating an empty one on first read so the
// wizard always has a stable record to update (idempotent upsert on org+user).
export async function getOrCreateState(
  orgId: string,
  userId: string,
  pool: Pool = getPool()
): Promise<OnboardingState> {
  const { rows } = await pool.query<OnboardingRow>(
    `insert into onboarding_state (org_id, user_id)
     values ($1, $2)
     on conflict (org_id, user_id) do update set org_id = excluded.org_id
     returning id, org_id, user_id, steps, completed, created_at`,
    [orgId, userId]
  );
  return mapState(rows[0]);
}

// Marks a single step complete (idempotent) and flips `completed` once every
// non-optional step has a timestamp. Returns the updated state.
export async function completeStep(
  orgId: string,
  userId: string,
  step: StepId,
  pool: Pool = getPool()
): Promise<OnboardingState> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    // Ensure a row exists, then read current steps for-update.
    await client.query(
      `insert into onboarding_state (org_id, user_id)
       values ($1, $2)
       on conflict (org_id, user_id) do nothing`,
      [orgId, userId]
    );
    const { rows } = await client.query<OnboardingRow>(
      `select id, org_id, user_id, steps, completed, created_at
         from onboarding_state
        where org_id = $1 and user_id = $2
        for update`,
      [orgId, userId]
    );
    const current = mapState(rows[0]);
    const nextSteps: StepMap = {
      ...current.steps,
      [step]: current.steps[step] ?? new Date().toISOString(),
    };
    const requiredDone = STEP_META.filter(
      (s) => !s.optional && nextSteps[s.id]
    ).length;
    const requiredTotal = STEP_META.filter((s) => !s.optional).length;
    const completed = requiredDone >= requiredTotal;

    const { rows: updated } = await client.query<OnboardingRow>(
      `update onboarding_state
          set steps = $3, completed = $4
        where org_id = $1 and user_id = $2
        returning id, org_id, user_id, steps, completed, created_at`,
      [orgId, userId, JSON.stringify(nextSteps), completed]
    );
    await client.query("commit");
    return mapState(updated[0]);
  } catch (err) {
    await client.query("rollback").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Checklist — derived view over STEP_META + the caller's state.
// ---------------------------------------------------------------------------

export function buildChecklist(state: OnboardingState): Checklist {
  const items: ChecklistItem[] = STEP_META.map((meta) => {
    const completedAt = state.steps[meta.id] ?? null;
    return {
      id: meta.id,
      title: meta.title,
      blurb: meta.blurb,
      optional: meta.optional,
      done: Boolean(completedAt),
      completed_at: completedAt,
    };
  });
  const required = items.filter((i) => !i.optional);
  const requiredDone = required.filter((i) => i.done).length;
  const requiredTotal = required.length;
  const percent =
    requiredTotal === 0 ? 100 : Math.round((requiredDone / requiredTotal) * 100);
  return {
    items,
    completed: state.completed,
    required_total: requiredTotal,
    required_done: requiredDone,
    percent,
  };
}

// ---------------------------------------------------------------------------
// Sample data seeding — a demo project + one demo claim, strictly org-scoped.
// ---------------------------------------------------------------------------

export const SAMPLE_PROJECT_NAME = "Sample: Getting Started";
export const SAMPLE_CLAIM_TEXT =
  "In a Phase 3 trial, Drug X reduced major cardiovascular events by 30% versus placebo over 24 months.";
export const SAMPLE_CLAIM_SOURCE_URL = "https://pubmed.ncbi.nlm.nih.gov/00000000/";

export interface SeededSample {
  project: { id: string; name: string };
  claim: { id: string; text: string };
  already_existed: boolean;
}

// Creates (once) a demo project and a demo claim for the org. Idempotent per org:
// if the sample project already exists it is reused rather than duplicated, so a
// user clicking "Load sample data" twice never litters the workspace.
export async function seedSample(
  orgId: string,
  userId: string,
  pool: Pool = getPool()
): Promise<SeededSample> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query("begin");

    const existingProject = await client.query<{ id: string; name: string }>(
      `select id, name from projects
        where org_id = $1 and name = $2
        limit 1`,
      [orgId, SAMPLE_PROJECT_NAME]
    );

    let projectId: string;
    let projectName: string;
    let alreadyExisted = false;

    if (existingProject.rows.length > 0) {
      projectId = existingProject.rows[0].id;
      projectName = existingProject.rows[0].name;
      alreadyExisted = true;
    } else {
      const inserted = await client.query<{ id: string; name: string }>(
        `insert into projects (org_id, name, description, status, created_by)
         values ($1, $2, $3, 'active', $4)
         returning id, name`,
        [
          orgId,
          SAMPLE_PROJECT_NAME,
          "A demo project seeded during onboarding so you can explore a full provenance trail.",
          userId,
        ]
      );
      projectId = inserted.rows[0].id;
      projectName = inserted.rows[0].name;
    }

    // Reuse the demo claim if one already exists in the sample project.
    const existingClaim = await client.query<{ id: string; text: string }>(
      `select id, text from claims
        where org_id = $1 and project_id = $2 and text = $3
        limit 1`,
      [orgId, projectId, SAMPLE_CLAIM_TEXT]
    );

    let claimId: string;
    let claimText: string;
    if (existingClaim.rows.length > 0) {
      claimId = existingClaim.rows[0].id;
      claimText = existingClaim.rows[0].text;
      alreadyExisted = true;
    } else {
      const insertedClaim = await client.query<{ id: string; text: string }>(
        `insert into claims (org_id, project_id, text, status, cited_source_url, submitted_by)
         values ($1, $2, $3, 'draft', $4, $5)
         returning id, text`,
        [orgId, projectId, SAMPLE_CLAIM_TEXT, SAMPLE_CLAIM_SOURCE_URL, userId]
      );
      claimId = insertedClaim.rows[0].id;
      claimText = insertedClaim.rows[0].text;
    }

    await client.query("commit");
    return {
      project: { id: projectId, name: projectName },
      claim: { id: claimId, text: claimText },
      already_existed: alreadyExisted,
    };
  } catch (err) {
    await client.query("rollback").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
