import { ok, fail } from "@/lib/api/response";

// Public, non-org trust summary. Exposes only high-level, static capability and
// build information — NO tenant data, NO database access, NO auth. Safe to call
// anonymously (it powers the public /security trust center). Anything tenant-
// specific must go through an org-scoped route behind withOrg instead.
export const runtime = "nodejs";

interface Capability {
  key: string;
  title: string;
  description: string;
}

interface BuildInfo {
  name: string;
  environment: string;
  commit: string;
  region: string;
  generated_at: string;
}

interface TrustSummary {
  product: string;
  summary: string;
  capabilities: readonly Capability[];
  build: BuildInfo;
}

const CAPABILITIES: readonly Capability[] = [
  {
    key: "deterministic_verification",
    title: "Deterministic effect-size cross-check",
    description:
      "Reported estimates and confidence intervals (RR, HR, OR, RRR) are parsed and checked against fixed statistical rules in code. Because the check is deterministic, its verdict cannot be made to wobble by resubmitting the same claim.",
  },
  {
    key: "code_enforced_provenance",
    title: "Code-enforced provenance",
    description:
      "Every flagged source span is located inside the cached source text before it is shown. Spans that cannot be located are dropped, so the tool structurally cannot make an unsourced claim about a source.",
  },
  {
    key: "abstain_on_low_confidence",
    title: "Honest abstention",
    description:
      "When retrieval finds no confident primary-source match, the tool returns 'no support found' rather than forcing a low-confidence answer.",
  },
  {
    key: "rbac",
    title: "Role-based access control",
    description:
      "Access is scoped by organization and role (owner, admin, editor, viewer). Every authenticated route resolves the caller's org membership and enforces the minimum required role.",
  },
  {
    key: "audit_trail",
    title: "Tamper-evident audit trail",
    description:
      "Mutations are recorded in an append-only, hash-chained audit ledger. Each entry is bound to the previous one, so altering a past event breaks every subsequent hash.",
  },
  {
    key: "tenant_isolation",
    title: "Tenant isolation",
    description:
      "All tenant data is org-scoped at the query level. Public endpoints such as this one expose no tenant data of any kind.",
  },
] as const;

export async function GET(): Promise<Response> {
  try {
    const build: BuildInfo = {
      name: "PaperTrail",
      environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development",
      commit: (process.env.VERCEL_GIT_COMMIT_SHA ?? "unknown").slice(0, 12),
      region: process.env.VERCEL_REGION ?? "local",
      generated_at: new Date().toISOString(),
    };

    const data: TrustSummary = {
      product: "PaperTrail",
      summary:
        "A provenance and verification agent for clinical-trial efficacy claims. It traces a claim to its primary source, extracts the actual finding, and flags discrepancies with a trust score and an exact-span citation trail.",
      capabilities: CAPABILITIES,
      build,
    };

    return ok(data);
  } catch {
    return fail("Unable to load trust summary.", 500);
  }
}
