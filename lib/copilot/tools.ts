import type { Pool } from "pg";
import { z } from "zod";
import { retrieveSources } from "@/lib/agents/retrievalAgent";
import { runEvidencePipeline } from "@/lib/evidencePipeline";
import { extractFinding } from "@/lib/agents/extractionAgent";
import { verifyClaim } from "@/lib/agents/verificationAgent";
import { reconcile } from "@/lib/effectSize";
import { checkAgainstRegistry } from "@/lib/structuredVerification";
import { verifyBiomedicalClaim } from "@/lib/bio/verifyBiomedicalClaim";
import { parseSourceId } from "@/lib/sourceId";
import { buildEvidenceDossier, type ClinicalTrialsResult } from "@/lib/dossier/build";
import {
  SUBJECT_TYPES,
  type DossierCitation,
  type EvidenceDossier,
} from "@/lib/dossier/schemas";
import { searchAndCache } from "@/lib/ingest/searchAndCache";
import type { TrialResultAnalysis } from "@/lib/sources/clinicaltrials";
import type { SourceCandidate } from "@/lib/schemas";

// COPILOT TOOL SURFACE — the capabilities the conversational agent may invoke.
// Each tool is a thin, schema-validated adapter over an EXISTING PaperTrail engine:
// nothing here re-implements retrieval, extraction, verification, or synthesis; it
// only re-exposes them behind a stable tool contract the agent-loop can call.
//
// GROUNDING CONTRACT (the whole reason the copilot is trustworthy):
//   - Every tool that touches a primary source returns a `_citations` array of the
//     EXACT sources it read (title/url/external_id from the cached `sources` rows).
//   - The agent loop harvests those `_citations` and is told it may only cite a
//     source by the number the server assigned. The model therefore cannot invent a
//     paper — a citation that isn't in some tool result simply doesn't exist.
//   - All numeric claims (pooled effect, GRADE, registry check, effect-size verdict)
//     come from the deterministic engines, not the model. The model orchestrates and
//     explains; the engines decide the numbers.

// ---------------------------------------------------------------------------
// A citation as emitted BY a tool (before the agent loop assigns a global index).
// ---------------------------------------------------------------------------
export interface ToolCitation {
  title: string | null;
  url: string;
  source_type: string;
  external_id: string | null;
}

// The structural result every executor returns: an opaque `output` (fed back to
// Claude as the tool_result), plus the citations that output is grounded in.
export interface CopilotToolOutput {
  output: unknown;
  citations: ToolCitation[];
}

// A copilot tool: Anthropic tool metadata (name/description/JSON input schema for
// the wire) PLUS the zod schema (server-side validation) and the executor.
export interface CopilotTool<TInput = unknown> {
  name: string;
  description: string;
  inputSchema: z.ZodType<TInput>;
  jsonSchema: Record<string, unknown>;
  execute: (input: TInput, pool: Pool) => Promise<CopilotToolOutput>;
}

function toCitation(s: {
  title: string | null;
  url: string;
  source_type: string;
  external_id: string;
}): ToolCitation {
  return {
    title: s.title,
    url: s.url,
    source_type: s.source_type,
    external_id: s.external_id,
  };
}

function candidateCitation(s: SourceCandidate): ToolCitation {
  return {
    title: s.title,
    url: s.url,
    source_type: s.source_type,
    external_id: s.external_id,
  };
}

// ---------------------------------------------------------------------------
// Tool 1: search_sources — semantic retrieval over the cached `sources` table.
// ---------------------------------------------------------------------------
const searchSourcesInput = z.object({
  query: z
    .string()
    .min(3)
    .max(2000)
    .describe("Free-text query to semantically search PaperTrail's cached primary sources."),
});

const searchSourcesJsonSchema = {
  type: "object",
  properties: {
    query: {
      type: "string",
      description: "Free-text query to semantically search PaperTrail's cached primary sources.",
    },
  },
  required: ["query"],
} as const;

async function runSearchSources(
  input: z.infer<typeof searchSourcesInput>
): Promise<CopilotToolOutput> {
  const sources = await retrieveSources(input.query);
  if (sources.length === 0) {
    return {
      output: {
        status: "no_confident_match",
        message:
          "No cached primary source matched this query with confidence. This is reported honestly rather than returning an unrelated source.",
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
    citations: sources.map(candidateCitation),
  };
}

// ---------------------------------------------------------------------------
// Tool 2: verify_claim — the core verify pipeline (retrieve → extract → verify)
// plus the deterministic effect-size and registry cross-checks. LLM does the
// extraction/verification reasoning; the deterministic checks ground it.
// ---------------------------------------------------------------------------
const verifyClaimInput = z.object({
  claim: z
    .string()
    .min(10)
    .max(2000)
    .describe("A clinical-trial efficacy claim to verify against its retrieved primary source."),
  source_hint: z
    .string()
    .max(200)
    .optional()
    .describe("Optional DOI / PMID / NCT id the claim cited, to pin retrieval to that source."),
});

const verifyClaimJsonSchema = {
  type: "object",
  properties: {
    claim: {
      type: "string",
      description:
        "A clinical-trial efficacy claim to verify against its retrieved primary source.",
    },
    source_hint: {
      type: "string",
      description: "Optional DOI / PMID / NCT id the claim cited, to pin retrieval to that source.",
    },
  },
  required: ["claim"],
} as const;

async function runVerifyClaim(
  input: z.infer<typeof verifyClaimInput>
): Promise<CopilotToolOutput> {
  const parsedHint = input.source_hint ? parseSourceId(input.source_hint) : null;
  const sources = await retrieveSources(
    input.claim,
    parsedHint ? { preferExternalId: parsedHint.id } : undefined
  );

  if (sources.length === 0) {
    return {
      output: {
        status: "no_support_found",
        message:
          "No confident matching primary source was found in PubMed or ClinicalTrials.gov for this claim. This does not mean the claim is false — only that this tool could not verify it against a retrievable source.",
      },
      citations: [],
    };
  }

  const source = sources[0];
  const findings = await Promise.all(sources.map((s) => extractFinding(s.id, s.raw_text)));
  const finding = findings[0];

  const verification = await verifyClaim({
    claim: input.claim,
    finding,
    sourceRawText: source.raw_text,
    otherFindings: findings.slice(1),
  });

  // Deterministic cross-checks that ground the LLM verdict.
  const effectSizeCheck = reconcile(input.claim, source.raw_text);
  const registeredResults = (source.registered_results ?? []) as TrialResultAnalysis[];
  const registryCheck =
    source.source_type === "clinicaltrials"
      ? checkAgainstRegistry(input.claim, registeredResults)
      : null;

  return {
    output: {
      status: "verified",
      source: toCitation(source),
      corroborating_sources: sources.slice(1).map(toCitation),
      finding,
      verification,
      effect_size_check: effectSizeCheck,
      registry_check: registryCheck,
    },
    citations: sources.map(candidateCitation),
  };
}

// ---------------------------------------------------------------------------
// Tool 3: run_synthesis — the full claim→evidence-report pipeline: retrieve
// candidate sources, deterministically extract each primary ratio effect, pool
// them (meta-analysis → publication bias → GRADE → verdict). NO LLM in the numbers.
// ---------------------------------------------------------------------------
const runSynthesisInput = z.object({
  claim: z
    .string()
    .min(10)
    .max(2000)
    .describe("The efficacy claim to synthesise a pooled body of evidence for."),
  query: z
    .string()
    .min(1)
    .max(2000)
    .optional()
    .describe("Optional search-steering query; defaults to the claim text."),
  limit: z
    .number()
    .int()
    .positive()
    .max(20)
    .optional()
    .describe("Optional cap on how many candidate sources to pool (1-20)."),
});

const runSynthesisJsonSchema = {
  type: "object",
  properties: {
    claim: {
      type: "string",
      description: "The efficacy claim to synthesise a pooled body of evidence for.",
    },
    query: {
      type: "string",
      description: "Optional search-steering query; defaults to the claim text.",
    },
    limit: {
      type: "integer",
      description: "Optional cap on how many candidate sources to pool (1-20).",
    },
  },
  required: ["claim"],
} as const;

async function runRunSynthesis(
  input: z.infer<typeof runSynthesisInput>,
  pool: Pool
): Promise<CopilotToolOutput> {
  const result = await runEvidencePipeline(pool, {
    claim: input.claim,
    query: input.query,
    limit: input.limit,
  });

  // The pipeline's usedSources only carry id/title/source_type; re-derive full
  // citations (url/external_id) from retrieval so the grounding trail is complete.
  const searchText = input.query ?? input.claim;
  const retrieved = await retrieveSources(searchText);
  const citations = retrieved
    .filter((s) => result.usedSources.some((u) => u.id === s.id))
    .map(candidateCitation);

  return {
    output: {
      claim: result.claim,
      report: result.report,
      used_sources: result.usedSources,
      skipped: result.skipped,
    },
    citations,
  };
}

// ---------------------------------------------------------------------------
// Tool 4: verify_biomedical_evidence — compose the deterministic bio engines
// (genetic association, target–disease, drug safety/FAERS, ChEMBL bioactivity,
// ClinVar pathogenicity, pharmacogenomics) into one verdict for a claim that
// mentions genes / variants / drugs / diseases.
// ---------------------------------------------------------------------------
const bioVerifyInput = z.object({
  claim: z
    .string()
    .min(3)
    .max(2000)
    .describe(
      "A biomedical claim mentioning genes, variants, drugs, and/or diseases (e.g. 'PCSK9 inhibition is genetically validated for coronary artery disease')."
    ),
});

const bioVerifyJsonSchema = {
  type: "object",
  properties: {
    claim: {
      type: "string",
      description:
        "A biomedical claim mentioning genes, variants, drugs, and/or diseases to verify against genetic (GWAS/Open Targets), safety (FAERS), bioactivity (ChEMBL), pathogenicity (ClinVar), and pharmacogenomic evidence.",
    },
  },
  required: ["claim"],
} as const;

async function runBioVerify(
  input: z.infer<typeof bioVerifyInput>
): Promise<CopilotToolOutput> {
  const result = await verifyBiomedicalClaim({ claim: input.claim });
  // Bio checks carry their own source labels inside the output; no cached-source
  // citations to harvest here (these are external open bio-databases).
  return { output: result, citations: [] };
}

// ---------------------------------------------------------------------------
// Tool 5: build_evidence_dossier — the flagship. Assemble a COMPLETE, verified,
// cited, trust-scored evidence dossier for a subject (target gene / drug / disease /
// claim) by composing the deterministic bio + evidence engines. Claude only PLANS
// which sections apply and NARRATES over the already-verified sections; the overall
// score/grade and every section number are DETERMINISTIC (see lib/dossier/build.ts).
// This tool is a thin adapter over buildEvidenceDossier — it adds nothing to the
// numbers; it only wires the efficacy pipeline behind the dossier's injectable dep.
// ---------------------------------------------------------------------------
const buildDossierInput = z.object({
  subjectType: z
    .enum(SUBJECT_TYPES)
    .describe(
      "What the subject is: 'target' (a gene/protein), 'drug', 'disease', or 'claim' (a free-text biomedical claim). This routes which deterministic evidence sections apply."
    ),
  subject: z
    .string()
    .trim()
    .min(1)
    .max(500)
    .describe(
      "The primary entity or claim text — e.g. a gene symbol ('PCSK9'), a drug name, a disease name, or a full claim."
    ),
  disease: z
    .string()
    .trim()
    .min(1)
    .max(300)
    .optional()
    .describe(
      "Optional disease context for association/efficacy checks when the subject is a target or drug (e.g. subject 'PCSK9', disease 'hypercholesterolemia')."
    ),
});

const buildDossierJsonSchema = {
  type: "object",
  properties: {
    subjectType: {
      type: "string",
      enum: [...SUBJECT_TYPES],
      description:
        "What the subject is: 'target' (a gene/protein), 'drug', 'disease', or 'claim'. Routes which deterministic evidence sections apply.",
    },
    subject: {
      type: "string",
      description:
        "The primary entity or claim text — a gene symbol, a drug name, a disease name, or a full claim.",
    },
    disease: {
      type: "string",
      description:
        "Optional disease context for association/efficacy checks when the subject is a target or drug.",
    },
  },
  required: ["subjectType", "subject"],
} as const;

// A dossier citation ({ source, ref, detail }) maps to the copilot's ToolCitation
// grounding shape. The bio/evidence engines cite open databases (Open Targets, GWAS
// Catalog, ChEMBL, FAERS, ...) which have no cached-source URL/external_id, so `url`
// carries the human source label and `external_id` the engine's ref (e.g. an Ensembl
// or ChEMBL id). This keeps every number in the dossier traceable to its origin.
function dossierCitation(c: DossierCitation): ToolCitation {
  return {
    title: c.detail,
    url: c.source,
    source_type: "bio_database",
    external_id: c.ref,
  };
}

// Collect the citations across all verified sections, deduped by (source, ref, detail)
// so the same database pointer cited by two sections surfaces once.
function harvestDossierCitations(dossier: EvidenceDossier): ToolCitation[] {
  const seen = new Set<string>();
  const out: ToolCitation[] = [];
  for (const section of dossier.sections) {
    for (const c of section.citations) {
      const key = `${c.source}|${c.ref ?? ""}|${c.detail ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(dossierCitation(c));
    }
  }
  return out;
}

// Wire the real efficacy pipeline behind the dossier's `clinicalTrials` injectable dep,
// mirroring app/api/dossier/route.ts: ingest (cache-everything) then pool. Returns null
// on any failure so the clinical_trials section is dropped (honest omission), never
// fabricated. Cached sources are never re-fetched — searchAndCache is best-effort.
function copilotClinicalTrialsAdapter(pool: Pool) {
  return async (input: {
    claim: string;
    query?: string;
  }): Promise<ClinicalTrialsResult | null> => {
    try {
      await searchAndCache(pool, { query: input.query ?? input.claim }).catch(
        () => undefined
      );
      const pipeline = await runEvidencePipeline(pool, {
        claim: input.claim,
        query: input.query,
      });
      const report = pipeline.report;
      const usableStudies = report.ok
        ? pipeline.usedSources.length
        : report.usableStudies;
      return {
        usableStudies,
        usedSourceCount: pipeline.usedSources.length,
        poolable: report.ok === true,
        citations: pipeline.usedSources.slice(0, 10).map((s) => ({
          source: s.source_type,
          ref: s.id,
          detail: s.title,
        })),
        detail: pipeline,
      };
    } catch {
      return null;
    }
  };
}

async function runBuildDossier(
  input: z.infer<typeof buildDossierInput>,
  pool: Pool
): Promise<CopilotToolOutput> {
  const dossier = await buildEvidenceDossier(
    { subjectType: input.subjectType, subject: input.subject, disease: input.disease },
    { clinicalTrials: copilotClinicalTrialsAdapter(pool) }
  );
  return {
    output: dossier,
    citations: harvestDossierCitations(dossier),
  };
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------
export const COPILOT_TOOLS: CopilotTool[] = [
  {
    name: "search_sources",
    description:
      "Semantically search PaperTrail's cached primary sources (PubMed abstracts + ClinicalTrials.gov trials) for a free-text query. Returns the best matches with similarity scores. Use this to find what evidence exists before verifying or synthesising. Returns an honest 'no confident match' when nothing is relevant.",
    inputSchema: searchSourcesInput,
    jsonSchema: searchSourcesJsonSchema,
    execute: (input) => runSearchSources(input as z.infer<typeof searchSourcesInput>),
  },
  {
    name: "verify_claim",
    description:
      "Verify a single clinical-trial efficacy claim against its retrieved primary source. Returns a trust score, discrepancy type, grounded flagged spans, plus deterministic effect-size and ClinicalTrials.gov registry cross-checks. Use this when the user asks whether a specific claim is accurate.",
    inputSchema: verifyClaimInput,
    jsonSchema: verifyClaimJsonSchema,
    execute: (input) => runVerifyClaim(input as z.infer<typeof verifyClaimInput>),
  },
  {
    name: "run_synthesis",
    description:
      "Pool a body of evidence for a claim: find candidate primary sources, deterministically extract each trial's primary ratio effect, and combine them via meta-analysis, publication-bias testing, and GRADE certainty rating — returning one defensible composite report. All numbers are computed deterministically (no LLM). Use this when the user asks about the overall weight of evidence, effect size, or certainty across multiple trials. Honestly reports 'insufficient' with fewer than two poolable studies.",
    inputSchema: runSynthesisInput,
    jsonSchema: runSynthesisJsonSchema,
    execute: (input, pool) => runRunSynthesis(input as z.infer<typeof runSynthesisInput>, pool),
  },
  {
    name: "verify_biomedical_evidence",
    description:
      "Verify a biomedical claim across molecular evidence: it extracts the claim's genes/variants/drugs/diseases and routes to the deterministic bio engines — genetic association (GWAS Catalog + ClinVar, genome-wide significance), target–disease evidence (Open Targets), drug safety signals (openFDA/FAERS disproportionality), drug-target bioactivity (ChEMBL), variant pathogenicity (ClinVar star-rated), and pharmacogenomics (PharmGKB) — returning one deterministic verdict (supported / partially_supported / overstated / unsupported / insufficient_evidence). Use this for mechanism, genetic-validation, drug-safety, potency, or variant claims. No LLM decides the numbers or the verdict.",
    inputSchema: bioVerifyInput,
    jsonSchema: bioVerifyJsonSchema,
    execute: (input) => runBioVerify(input as z.infer<typeof bioVerifyInput>),
  },
  {
    name: "build_evidence_dossier",
    description:
      "Assemble a COMPLETE, verified, cited, trust-scored evidence dossier for a subject — a target gene, a drug, a disease, or a free-text claim. It composes the deterministic bio + evidence engines (genetic validation, target–disease association, tractability, existing drugs, safety liabilities, mechanism grounding, claim verification, and pooled clinical-trial efficacy) into one dossier with a deterministic overall score (0–1) and grade (strong / moderate / emerging / weak / contradicted). Claude only PLANS which sections apply and NARRATES over the already-verified sections — no LLM decides the score, grade, or any section number. Use this when the user wants a full evidence picture for a target/drug/disease/claim rather than a single check. Pass `disease` to unlock the association and efficacy sections for a target or drug subject.",
    inputSchema: buildDossierInput,
    jsonSchema: buildDossierJsonSchema,
    execute: (input, pool) => runBuildDossier(input as z.infer<typeof buildDossierInput>, pool),
  },
];

export const COPILOT_TOOLS_BY_NAME = new Map<string, CopilotTool>(
  COPILOT_TOOLS.map((t) => [t.name, t])
);
