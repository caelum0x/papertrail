import type { Pool } from "pg";
import { canonicalize, sha256Hex } from "@/lib/compliance/hash";
import { buildChainOfCustody } from "@/lib/provenance/chainOfCustody";
import type {
  BundleGap,
  BundleManifest,
  CustodyRecord,
  CustodySummary,
  FindingRow,
  MethodEntry,
  PooledEstimate,
  SubmissionBundleRequest,
} from "./schemas";

// REGULATORY SUBMISSION BUNDLE ASSEMBLER.
//
// assembleSubmissionBundle() composes a regulator-facing MANIFEST from PaperTrail's
// already-verified artefacts: stored verifications (claim-vs-source verdicts with a
// deterministic trust score + grounded spans) and/or one composite evidence report
// (pooled meta-analysis + GRADE certainty + synthesis verdict). It lays them into a
// CTD/eCTD-style section map — Summary of Findings, Methods, Evidence Table,
// Provenance Appendix — plus an honesty ledger of gaps.
//
// MOAT rules honoured here:
//  - NO LLM, no scoring, no verdict logic. Every number and span is COPIED verbatim
//    from an engine result that already produced it. This file only reshapes + hashes.
//  - Provenance is delegated to buildChainOfCustody(), which re-grounds every span
//    against the current cached source text and DROPS (counts) any that no longer
//    map to a verbatim substring. An ungroundable span never enters the bundle.
//  - Honest gaps (missing verification, no matched source, insufficient report, no
//    poolable estimate, dropped spans) are LISTED in `gaps`, never fabricated over.
//  - The bundle_hash is a sha256 over a canonical (key-sorted) manifest body with NO
//    wall-clock input, so re-assembling unchanged state yields an identical hash.
//
// Never logs claim or source text — the caller/route handles that boundary.

// ---------------------------------------------------------------------------
// Fixed method descriptions. These name the deterministic engines behind the
// numbers so an auditor can trace each figure to a field-standard method. They are
// static strings (not generated) and are only included when the corresponding kind
// of evidence is actually present in the bundle.
// ---------------------------------------------------------------------------
const VERIFICATION_METHOD: MethodEntry = {
  engine: "PaperTrail claim-vs-source verifier",
  description:
    "Deterministic comparison of an efficacy claim against the extracted finding " +
    "of its matched primary source. The discrepancy type and 0–100 trust score are " +
    "computed by rule from the parsed magnitudes, population, and caveats — no " +
    "language model decides the verdict. Every flagged span maps to a verbatim " +
    "substring of the cached source text.",
};

const META_METHOD: MethodEntry = {
  engine: "Random-effects meta-analysis (DerSimonian–Laird)",
  description:
    "Ratio effect measures (RR/HR/OR) pooled on the natural-log scale with a " +
    "random-effects model; heterogeneity reported as I². Pooled point estimate and " +
    "95% confidence interval are computed deterministically from the supplied trial " +
    "estimates.",
};

const GRADE_METHOD: MethodEntry = {
  engine: "GRADE certainty rating",
  description:
    "Certainty of evidence rated High → Very low by applying GRADE / Cochrane " +
    "downgrade rules (inconsistency, imprecision, publication bias, risk of bias, " +
    "indirectness) to the pooled result. Each downgrade step is recorded with its " +
    "domain and reason.",
};

const BIAS_METHOD: MethodEntry = {
  engine: "Egger's test (funnel-plot asymmetry)",
  description:
    "Small-study effects / publication bias assessed by Egger's regression test " +
    "when at least three studies are pooled; a detected asymmetry deterministically " +
    "downgrades GRADE certainty by one step.",
};

const PROVENANCE_METHOD: MethodEntry = {
  engine: "Chain-of-custody grounding + hashing",
  description:
    "Each grounded span is re-located against the current cached source text and " +
    "sealed with a sha256 over its ordered provenance tuple (source id, external " +
    "identifiers, snapshot version, content hash, span offsets). Spans that no " +
    "longer ground to a verbatim substring are dropped and counted, never asserted.",
};

// ---------------------------------------------------------------------------
// Row shapes loaded from the database. Verifications are org-scoped by joining
// through the owning claim (verifications have no org_id of their own).
// ---------------------------------------------------------------------------
interface VerificationRow {
  id: string;
  claim_text: string;
  discrepancy_type: string | null;
  trust_score: number | null;
}

interface EvidenceReportRow {
  id: string;
  claim: string;
  verdict: string | null;
  certainty: string | null;
  report: unknown;
}

// Minimal read views over the stored composite EvidenceReport JSON. We only read
// the fields we copy verbatim; the full object shape lives in lib/evidenceReport.ts.
interface StoredPooled {
  measure?: unknown;
  k?: unknown;
  heterogeneity?: { iSquared?: unknown };
  random?: {
    point?: unknown;
    ciLower?: unknown;
    ciUpper?: unknown;
    significant?: unknown;
  };
}

interface StoredDowngrade {
  domain?: unknown;
  steps?: unknown;
  reason?: unknown;
}

interface StoredCertainty {
  certainty?: unknown;
  downgrades?: unknown;
}

interface StoredEvidenceReport {
  ok?: unknown;
  pooled?: StoredPooled;
  certainty?: StoredCertainty;
}

function isNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function asString(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

// ---------------------------------------------------------------------------
// Verification loading (org-scoped through claims) + custody assembly.
// ---------------------------------------------------------------------------
async function loadOrgVerifications(
  pool: Pool,
  orgId: string,
  ids: readonly string[]
): Promise<VerificationRow[]> {
  if (ids.length === 0) {
    return [];
  }
  const { rows } = await pool.query<VerificationRow>(
    `select v.id, v.claim_text, v.discrepancy_type, v.trust_score
       from verifications v
       join claims c on c.id = v.claim_id
      where c.org_id = $1
        and v.id = any($2::uuid[])`,
    [orgId, ids]
  );
  return rows;
}

// Deterministically map the chain-of-custody envelope to the bundle's typed summary.
// The custody builder already dropped + counted ungroundable spans.
function toCustodySummary(
  custody: Awaited<ReturnType<typeof buildChainOfCustody>>
): CustodySummary | null {
  if (!custody) {
    return null;
  }
  const records: CustodyRecord[] = custody.records.map((r) => ({
    verification_id: r.verification_id,
    source_id: r.source_id,
    doi: r.doi,
    pmid: r.pmid,
    source_version: r.source_version,
    snapshot_date: r.snapshot_date,
    content_hash: r.content_hash,
    source_span: r.source_span,
    span_start: r.span_start,
    span_end: r.span_end,
    chain_of_custody_hash: r.chain_of_custody_hash,
  }));
  return {
    verification_id: custody.verification_id,
    source_id: custody.source_id,
    source_version: custody.source_version,
    snapshot_date: custody.snapshot_date,
    content_hash: custody.content_hash,
    doi: custody.doi,
    pmid: custody.pmid,
    records,
    dropped_ungroundable: custody.dropped_ungroundable,
    aggregate_hash: custody.aggregate_hash,
  };
}

// ---------------------------------------------------------------------------
// Evidence-report loading + verbatim pooled-estimate extraction.
// ---------------------------------------------------------------------------
async function loadOrgEvidenceReport(
  pool: Pool,
  orgId: string,
  id: string
): Promise<EvidenceReportRow | null> {
  const { rows } = await pool.query<EvidenceReportRow>(
    `select id, claim, verdict, certainty, report
       from evidence_reports
      where org_id = $1 and id = $2`,
    [orgId, id]
  );
  return rows[0] ?? null;
}

// Copy the pooled random-effects estimate + GRADE downgrades out of a stored report.
// Returns null when the report is the insufficient shape (ok:false) or the pooled
// estimate is not fully numeric — the caller records that as an honest gap.
function extractPooledEstimate(report: unknown): PooledEstimate | null {
  const r = (report ?? {}) as StoredEvidenceReport;
  if (r.ok !== true) {
    return null;
  }
  const pooled = r.pooled;
  const random = pooled?.random;
  if (
    !pooled ||
    !random ||
    !isNumber(random.point) ||
    !isNumber(random.ciLower) ||
    !isNumber(random.ciUpper) ||
    !isNumber(pooled.k) ||
    !isNumber(pooled.heterogeneity?.iSquared)
  ) {
    return null;
  }
  const measure = asString(pooled.measure) ?? "RR";
  const certainty = asString(r.certainty?.certainty) ?? "very_low";
  const rawDowngrades = Array.isArray(r.certainty?.downgrades)
    ? (r.certainty?.downgrades as StoredDowngrade[])
    : [];
  const downgrades = rawDowngrades
    .filter((d): d is StoredDowngrade => Boolean(d))
    .map((d) => ({
      domain: asString(d.domain) ?? "unspecified",
      steps: isNumber(d.steps) ? d.steps : 1,
      reason: asString(d.reason) ?? "",
    }));

  return {
    measure,
    point: random.point,
    ci_lower: random.ciLower,
    ci_upper: random.ciUpper,
    ci_pct: 95,
    studies: pooled.k,
    i_squared: pooled.heterogeneity!.iSquared as number,
    significant: random.significant === true,
    certainty,
    downgrades,
  };
}

// Whether a pooled estimate was downgraded for publication bias — decides whether
// the Egger's-test method belongs in the Methods section.
function usedPublicationBias(estimate: PooledEstimate): boolean {
  return estimate.downgrades.some((d) => d.domain === "publication_bias");
}

// ---------------------------------------------------------------------------
// Assembly.
// ---------------------------------------------------------------------------

/**
 * Assemble a regulator-facing submission bundle manifest for one org.
 *
 * Deterministic, no-LLM composition of the requested verifications and/or a single
 * evidence report into a CTD/eCTD-style section map (Summary of Findings, Methods,
 * Evidence Table, Provenance Appendix) plus an honest `gaps` ledger. Every number and
 * span is copied verbatim from an engine result. The `bundle_hash` is a reproducible
 * sha256 over the canonical manifest body (no wall-clock input); `generated_at` is
 * carried outside that hashed body.
 *
 * Org isolation: verifications are scoped through their owning claim's org_id and the
 * evidence report is scoped by org_id, so ids belonging to another org are simply
 * absent and recorded as `not_found` gaps.
 */
export async function assembleSubmissionBundle(
  pool: Pool,
  orgId: string,
  input: SubmissionBundleRequest
): Promise<BundleManifest> {
  const requestedIds = input.verificationIds ?? [];
  const summary: FindingRow[] = [];
  const provenance: CustodySummary[] = [];
  const evidenceTable: PooledEstimate[] = [];
  const gaps: BundleGap[] = [];

  let groundedSpans = 0;
  let droppedSpans = 0;
  let verificationsIncluded = 0;
  let evidenceReportsIncluded = 0;

  let usedVerificationMethod = false;
  let usedMetaMethod = false;
  let usedGradeMethod = false;
  let usedBiasMethod = false;

  // --- Verifications --------------------------------------------------------
  if (requestedIds.length > 0) {
    const rows = await loadOrgVerifications(pool, orgId, requestedIds);
    const found = new Map(rows.map((row) => [row.id, row]));

    // Preserve caller order; record any id that is missing (wrong org or deleted).
    for (const id of requestedIds) {
      const row = found.get(id);
      if (!row) {
        gaps.push({
          kind: "verification_not_found",
          ref_id: id,
          detail:
            "Verification not found for this organization (deleted or belongs to another org).",
        });
        continue;
      }

      const custody = toCustodySummary(
        await buildChainOfCustody(pool, row.id)
      );
      const spanCount = custody?.records.length ?? 0;
      const dropped = custody?.dropped_ungroundable ?? 0;

      groundedSpans += spanCount;
      droppedSpans += dropped;
      verificationsIncluded += 1;
      usedVerificationMethod = true;

      summary.push({
        kind: "verification",
        ref_id: row.id,
        claim: row.claim_text,
        discrepancy_type: row.discrepancy_type,
        trust_score: row.trust_score,
        verdict: null,
        certainty: null,
        grounded_spans: spanCount,
      });

      if (custody) {
        provenance.push(custody);
      }

      // Honesty ledger: surface the provenance shortfalls per verification.
      if (!custody || custody.source_id === null) {
        gaps.push({
          kind: "no_matched_source",
          ref_id: row.id,
          detail:
            "No matched primary source is attached to this verification, so no " +
            "chain of custody could be assembled for it.",
        });
      } else if (spanCount === 0) {
        gaps.push({
          kind: "no_grounded_spans",
          ref_id: row.id,
          detail:
            "The matched source is present but no flagged span could be grounded " +
            "to a verbatim substring of its cached text.",
        });
      }
      if (dropped > 0) {
        gaps.push({
          kind: "ungroundable_spans_dropped",
          ref_id: row.id,
          detail: `${dropped} span${dropped === 1 ? "" : "s"} no longer ground to the current source text and ${dropped === 1 ? "was" : "were"} dropped from the bundle.`,
        });
      }
    }
  }

  // --- Evidence report ------------------------------------------------------
  if (input.evidenceReportId) {
    const report = await loadOrgEvidenceReport(
      pool,
      orgId,
      input.evidenceReportId
    );
    if (!report) {
      gaps.push({
        kind: "evidence_report_not_found",
        ref_id: input.evidenceReportId,
        detail:
          "Evidence report not found for this organization (deleted or belongs to another org).",
      });
    } else {
      evidenceReportsIncluded += 1;
      const estimate = extractPooledEstimate(report.report);

      summary.push({
        kind: "evidence_report",
        ref_id: report.id,
        claim: report.claim,
        discrepancy_type: null,
        trust_score: null,
        verdict: report.verdict,
        certainty: report.certainty ?? estimate?.certainty ?? null,
        grounded_spans: 0,
      });

      if (estimate) {
        evidenceTable.push(estimate);
        usedMetaMethod = true;
        usedGradeMethod = true;
        if (usedPublicationBias(estimate)) {
          usedBiasMethod = true;
        }
      } else {
        // Report exists but carries no poolable estimate — record the honest gap
        // rather than inventing an effect size for the evidence table.
        const insufficient =
          (report.report as StoredEvidenceReport | null)?.ok === false;
        gaps.push({
          kind: insufficient
            ? "evidence_report_insufficient"
            : "no_pooled_estimate",
          ref_id: report.id,
          detail: insufficient
            ? "The evidence report is an honest insufficient-evidence result (fewer than two poolable trials); no pooled estimate is included."
            : "The evidence report has no fully numeric pooled random-effects estimate; no row was added to the evidence table.",
        });
      }
    }
  }

  // --- Methods (only the engines actually exercised) ------------------------
  const methods: MethodEntry[] = [];
  if (usedVerificationMethod) methods.push(VERIFICATION_METHOD);
  if (usedMetaMethod) methods.push(META_METHOD);
  if (usedGradeMethod) methods.push(GRADE_METHOD);
  if (usedBiasMethod) methods.push(BIAS_METHOD);
  if (provenance.length > 0) methods.push(PROVENANCE_METHOD);

  const counts = {
    verifications_requested: requestedIds.length,
    verifications_included: verificationsIncluded,
    evidence_reports_included: evidenceReportsIncluded,
    grounded_spans: groundedSpans,
    dropped_ungroundable_spans: droppedSpans,
    gaps: gaps.length,
  };

  // The hashed body: everything auditable EXCEPT the wall-clock timestamp, so the
  // same underlying state reproduces the same bundle_hash (tamper-evident seal).
  const body = {
    org_id: orgId,
    summary_of_findings: summary,
    methods,
    evidence_table: evidenceTable,
    provenance_appendix: provenance,
    gaps,
    counts,
  };
  const bundle_hash = sha256Hex(canonicalize(body));

  return {
    ...body,
    generated_at: new Date().toISOString(),
    bundle_hash,
  };
}
