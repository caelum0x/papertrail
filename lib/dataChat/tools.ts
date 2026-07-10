import type { Pool } from "pg";
import { z } from "zod";
import { listReports, getReport } from "@/lib/evidenceReports/repository";
import { evidenceReportAnalytics } from "@/lib/evidenceReports/analytics";
import { listClaims, getClaim } from "@/lib/claims/repository";
import { retrieveSources } from "@/lib/agents/retrievalAgent";

// DATA-CHAT TOOL SURFACE — the capabilities the conversational agent may invoke
// against ONE ORG's own evidence library. Every tool is a thin, schema-validated
// adapter over an EXISTING org-scoped repository; nothing here re-implements data
// access, and — critically — nothing here trusts a client value for the tenant.
//
// TENANCY CONTRACT (the whole reason Data Chat is safe to expose over tenant data):
//   - Every executor receives `orgId` from the SERVER-resolved request context
//     (withOrg → ctx.org.id), never from the model, the message, or the client.
//   - Every underlying query already filters on org_id as its FIRST predicate
//     (evidenceReports/repository, claims/repository), so a tool physically cannot
//     read another tenant's rows even if the model asked it to.
//   - retrieveSources reads the SHARED cached-primary-source library (PubMed /
//     ClinicalTrials.gov) — that cache is not tenant data, but the org's own
//     *evidence* (which sources it saved into reports, which claims it filed) is,
//     and those come only from the org-scoped report/claim tools.
//
// GROUNDING CONTRACT: every tool returns a `citations` array of the EXACT tenant
// objects it read (report id / source url / claim id). The agent loop harvests
// those and is told it may cite only by the server-assigned number — so the model
// cannot invent a saved report, a source, or a claim.

// ---------------------------------------------------------------------------
// A citation as emitted BY a tool (before the agent loop assigns a global index).
// ---------------------------------------------------------------------------
export interface DataToolCitation {
  kind: "evidence_report" | "source" | "claim";
  title: string | null;
  // Stable identity: report/claim uuid, or source url. Used both as the dedupe key
  // and as the value surfaced to the model + UI.
  ref: string;
  // Relative console link for report/claim citations; null for external sources.
  href: string | null;
}

// The structural result every executor returns: an opaque `output` (fed back to
// Claude as the tool_result), plus the citations that output is grounded in.
export interface DataChatToolOutput {
  output: unknown;
  citations: DataToolCitation[];
}

// A data-chat tool: Anthropic metadata (name/description/JSON input schema for the
// wire) PLUS the zod schema (server-side validation) and the org-scoped executor.
// The executor signature bakes in `orgId` as a REQUIRED, server-supplied argument —
// there is no code path that runs a tool without a tenant scope.
export interface DataChatTool<TInput = unknown> {
  name: string;
  description: string;
  inputSchema: z.ZodType<TInput>;
  jsonSchema: Record<string, unknown>;
  execute: (input: TInput, pool: Pool, orgId: string) => Promise<DataChatToolOutput>;
}

const PAGE_MAX = 20;

// ---------------------------------------------------------------------------
// Tool 1: list_evidence_reports — the org's saved evidence reports, newest first.
// Also returns at-a-glance analytics (verdict / GRADE-certainty distribution) so
// the agent can answer "what does our library look like" without reading each row.
// ---------------------------------------------------------------------------
const listEvidenceReportsInput = z.object({
  limit: z
    .number()
    .int()
    .positive()
    .max(PAGE_MAX)
    .optional()
    .describe("How many recent saved reports to list (1-20; default 10)."),
});

const listEvidenceReportsJsonSchema = {
  type: "object",
  properties: {
    limit: {
      type: "integer",
      description: "How many recent saved reports to list (1-20; default 10).",
    },
  },
  required: [],
} as const;

async function runListEvidenceReports(
  input: z.infer<typeof listEvidenceReportsInput>,
  pool: Pool,
  orgId: string
): Promise<DataChatToolOutput> {
  const limit = input.limit ?? 10;
  const [{ items, total }, analytics] = await Promise.all([
    listReports(pool, { orgId, limit, offset: 0 }),
    evidenceReportAnalytics(pool, { orgId }),
  ]);

  if (items.length === 0) {
    return {
      output: {
        status: "empty",
        message:
          "This organization has no saved evidence reports yet. Answer honestly that the library is empty rather than inventing reports.",
        total: 0,
      },
      citations: [],
    };
  }

  return {
    output: {
      status: "found",
      total,
      analytics: {
        by_certainty: analytics.byCertainty,
        by_verdict: analytics.byVerdict,
        per_month: analytics.perMonth,
      },
      reports: items.map((r) => ({
        id: r.id,
        claim: r.claim,
        verdict: r.verdict,
        certainty: r.certainty,
        created_at: r.createdAt,
      })),
    },
    citations: items.map((r) => ({
      kind: "evidence_report" as const,
      title: r.claim,
      ref: r.id,
      href: `/console/evidence-reports/${r.id}`,
    })),
  };
}

// ---------------------------------------------------------------------------
// Tool 2: get_evidence_report — the full composite payload of ONE saved report,
// so the agent can quote the pooled effect, GRADE rationale, and flagged spans
// that report actually recorded. org-scoped: a report id from another tenant
// simply returns "not found".
// ---------------------------------------------------------------------------
const getEvidenceReportInput = z.object({
  report_id: z
    .string()
    .uuid()
    .describe("The id of a saved evidence report (from list_evidence_reports)."),
});

const getEvidenceReportJsonSchema = {
  type: "object",
  properties: {
    report_id: {
      type: "string",
      description: "The id of a saved evidence report (from list_evidence_reports).",
    },
  },
  required: ["report_id"],
} as const;

async function runGetEvidenceReport(
  input: z.infer<typeof getEvidenceReportInput>,
  pool: Pool,
  orgId: string
): Promise<DataChatToolOutput> {
  const report = await getReport(pool, orgId, input.report_id);
  if (!report) {
    return {
      output: {
        status: "not_found",
        message:
          "No saved evidence report with that id exists in this organization. Do not fabricate its contents.",
      },
      citations: [],
    };
  }

  return {
    output: {
      status: "found",
      id: report.id,
      claim: report.claim,
      verdict: report.verdict,
      certainty: report.certainty,
      created_at: report.createdAt,
      // The stored composite objects verbatim — the engine's numbers, grounded
      // spans, and rationale live here. The agent quotes, never recomputes.
      pooled: report.pooled,
      report: report.report,
    },
    citations: [
      {
        kind: "evidence_report",
        title: report.claim,
        ref: report.id,
        href: `/console/evidence-reports/${report.id}`,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Tool 3: search_org_sources — semantic retrieval over the cached primary-source
// library the org verifies against (PubMed / ClinicalTrials.gov). Finds the sources
// most relevant to a question so the agent can ground its answer in real records.
// ---------------------------------------------------------------------------
const searchOrgSourcesInput = z.object({
  query: z
    .string()
    .min(3)
    .max(2000)
    .describe("Free-text query to semantically search the cached primary sources."),
});

const searchOrgSourcesJsonSchema = {
  type: "object",
  properties: {
    query: {
      type: "string",
      description: "Free-text query to semantically search the cached primary sources.",
    },
  },
  required: ["query"],
} as const;

async function runSearchOrgSources(
  input: z.infer<typeof searchOrgSourcesInput>
): Promise<DataChatToolOutput> {
  const sources = await retrieveSources(input.query);
  if (sources.length === 0) {
    return {
      output: {
        status: "no_confident_match",
        message:
          "No cached primary source matched this query with confidence. Report this honestly rather than returning an unrelated source.",
        sources: [],
      },
      citations: [],
    };
  }
  return {
    output: {
      status: "found",
      count: sources.length,
      sources: sources.map((s) => ({
        title: s.title,
        url: s.url,
        source_type: s.source_type,
        external_id: s.external_id,
        similarity: Number(s.similarity.toFixed(3)),
        phase: s.phase ?? null,
        enrollment_count: s.enrollment_count ?? null,
      })),
    },
    citations: sources.map((s) => ({
      kind: "source" as const,
      title: s.title,
      ref: s.url,
      href: null,
    })),
  };
}

// ---------------------------------------------------------------------------
// Tool 4: search_claims — the org's OWN filed claims (the claims it is tracking /
// has verified). org-scoped list with an optional text filter and status filter.
// ---------------------------------------------------------------------------
const searchClaimsInput = z.object({
  query: z
    .string()
    .max(200)
    .optional()
    .describe("Optional case-insensitive substring to filter the org's claims by text."),
  status: z
    .enum(["draft", "submitted", "verifying", "verified", "flagged", "archived"])
    .optional()
    .describe("Optional status filter."),
  limit: z
    .number()
    .int()
    .positive()
    .max(PAGE_MAX)
    .optional()
    .describe("How many claims to return (1-20; default 10)."),
});

const searchClaimsJsonSchema = {
  type: "object",
  properties: {
    query: {
      type: "string",
      description: "Optional case-insensitive substring to filter the org's claims by text.",
    },
    status: {
      type: "string",
      enum: ["draft", "submitted", "verifying", "verified", "flagged", "archived"],
      description: "Optional status filter.",
    },
    limit: {
      type: "integer",
      description: "How many claims to return (1-20; default 10).",
    },
  },
  required: [],
} as const;

async function runSearchClaims(
  input: z.infer<typeof searchClaimsInput>,
  pool: Pool,
  orgId: string
): Promise<DataChatToolOutput> {
  const limit = input.limit ?? 10;
  const { items, total } = await listClaims(
    {
      orgId,
      filter: { q: input.query, status: input.status },
      limit,
      offset: 0,
    },
    pool
  );

  if (items.length === 0) {
    return {
      output: {
        status: "empty",
        message:
          "No claims in this organization match. If a filter was applied, say so; do not invent claims.",
        total: 0,
        claims: [],
      },
      citations: [],
    };
  }

  return {
    output: {
      status: "found",
      total,
      claims: items.map((c) => ({
        id: c.id,
        text: c.text,
        status: c.status,
        cited_source_url: c.cited_source_url,
        created_at: c.created_at,
      })),
    },
    citations: items.map((c) => ({
      kind: "claim" as const,
      title: c.text,
      ref: c.id,
      href: `/console/claims/${c.id}`,
    })),
  };
}

// ---------------------------------------------------------------------------
// Tool 5: get_claim — one claim in full. org-scoped; unknown id → "not found".
// ---------------------------------------------------------------------------
const getClaimInput = z.object({
  claim_id: z.string().uuid().describe("The id of a claim (from search_claims)."),
});

const getClaimJsonSchema = {
  type: "object",
  properties: {
    claim_id: { type: "string", description: "The id of a claim (from search_claims)." },
  },
  required: ["claim_id"],
} as const;

async function runGetClaim(
  input: z.infer<typeof getClaimInput>,
  pool: Pool,
  orgId: string
): Promise<DataChatToolOutput> {
  const claim = await getClaim(orgId, input.claim_id, pool);
  if (!claim) {
    return {
      output: {
        status: "not_found",
        message:
          "No claim with that id exists in this organization. Do not fabricate its contents.",
      },
      citations: [],
    };
  }
  return {
    output: {
      status: "found",
      id: claim.id,
      text: claim.text,
      status_value: claim.status,
      cited_source_url: claim.cited_source_url,
      created_at: claim.created_at,
      updated_at: claim.updated_at,
    },
    citations: [
      {
        kind: "claim",
        title: claim.text,
        ref: claim.id,
        href: `/console/claims/${claim.id}`,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------
export const DATA_CHAT_TOOLS: DataChatTool[] = [
  {
    name: "list_evidence_reports",
    description:
      "List this organization's saved evidence reports (newest first) with at-a-glance analytics: how many there are, and their distribution across GRADE certainty levels and verdicts. Use this to answer questions about the org's own body of saved work — 'what have we concluded', 'how many reports do we have', 'what's our certainty mix'. Returns 'empty' honestly when nothing is saved.",
    inputSchema: listEvidenceReportsInput,
    jsonSchema: listEvidenceReportsJsonSchema,
    execute: (input, pool, orgId) =>
      runListEvidenceReports(input as z.infer<typeof listEvidenceReportsInput>, pool, orgId),
  },
  {
    name: "get_evidence_report",
    description:
      "Fetch the full composite payload of ONE of this organization's saved evidence reports by id, including its pooled effect size, GRADE rationale, and any flagged spans. Use this after list_evidence_reports when the user asks about a specific saved report's details or numbers. All numbers are quoted from the stored report; do not recompute them.",
    inputSchema: getEvidenceReportInput,
    jsonSchema: getEvidenceReportJsonSchema,
    execute: (input, pool, orgId) =>
      runGetEvidenceReport(input as z.infer<typeof getEvidenceReportInput>, pool, orgId),
  },
  {
    name: "search_org_sources",
    description:
      "Semantically search the cached primary-source library (PubMed abstracts + ClinicalTrials.gov trials) that this organization verifies against, for a free-text query. Returns the best matching sources with similarity scores. Use this to ground an answer in real primary records. Returns an honest 'no confident match' when nothing is relevant.",
    inputSchema: searchOrgSourcesInput,
    jsonSchema: searchOrgSourcesJsonSchema,
    execute: (input) => runSearchOrgSources(input as z.infer<typeof searchOrgSourcesInput>),
  },
  {
    name: "search_claims",
    description:
      "Search this organization's own filed claims (the efficacy claims it is tracking), with an optional text substring filter and status filter. Use this to answer 'what claims are we tracking', 'which of our claims are flagged', or to find a claim before fetching its detail. Returns 'empty' honestly when nothing matches.",
    inputSchema: searchClaimsInput,
    jsonSchema: searchClaimsJsonSchema,
    execute: (input, pool, orgId) =>
      runSearchClaims(input as z.infer<typeof searchClaimsInput>, pool, orgId),
  },
  {
    name: "get_claim",
    description:
      "Fetch one of this organization's claims in full by id, including its status and cited source. Use this after search_claims when the user asks about a specific claim.",
    inputSchema: getClaimInput,
    jsonSchema: getClaimJsonSchema,
    execute: (input, pool, orgId) =>
      runGetClaim(input as z.infer<typeof getClaimInput>, pool, orgId),
  },
];

export const DATA_CHAT_TOOLS_BY_NAME = new Map<string, DataChatTool>(
  DATA_CHAT_TOOLS.map((t) => [t.name, t])
);
