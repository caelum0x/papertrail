// Biomedical evidence tools — CORE engines (part 1 of the biomedical group).
//
// Each tool is a thin, typed wrapper over one deterministic PaperTrail /api/bio
// endpoint. The heavy lifting (querying GWAS Catalog, ClinVar, Open Targets,
// openFDA FAERS, PubTator, etc. and computing a verdict) happens server-side;
// these tools only shape the request, POST it, and format the reply. All are
// read-only analyses over open bio-data.
//
// This file holds: entity annotation, safety signals, genetic association,
// variant pathogenicity, and target–disease evidence. The remaining engines live
// in biomedicalExtra.ts; biomedical.ts concatenates both into biomedicalTools.

import { z } from "zod";
import type { PaperTrailClient } from "../client.js";
import { tool, formatResult, toErrorMessage } from "../registry.js";
import type { PaperTrailTool } from "../registry.js";

// A POST handler factory: validate args against a zod object shape, POST the
// parsed body to `path`, and return a summary + pretty JSON. Keeps every tool's
// handler a one-liner and guarantees args are validated before any network call.
function postHandler(
  path: string,
  shape: z.ZodRawShape,
  summarize: (data: unknown) => string
) {
  const schema = z.object(shape);
  return async (
    args: Record<string, unknown>,
    client: PaperTrailClient
  ): Promise<string> => {
    try {
      const body = schema.parse(args);
      const data = await client.post<unknown>(path, body);
      return formatResult(summarize(data), data);
    } catch (err) {
      return toErrorMessage(err);
    }
  };
}

// Narrow an unknown API payload to a record so summaries can read fields safely.
function asRecord(data: unknown): Record<string, unknown> {
  return data && typeof data === "object" ? (data as Record<string, unknown>) : {};
}

const READ_ONLY = { readOnlyHint: true, openWorldHint: true } as const;

// ── bio_annotate_entities ──────────────────────────────────────────────────
// Exactly one of pmids / text. The API enforces the one-of rule; we keep both
// optional here and let the server return a clear validation message otherwise.
const bioAnnotateEntities = tool({
  name: "bio_annotate_entities",
  title: "Annotate Biomedical Entities",
  description:
    "Ground free biomedical text OR a batch of PubMed IDs into normalized entities " +
    "(genes, diseases, chemicals/drugs, variants, species) via NCBI PubTator Central. " +
    "Returns each mention with its normalized identifier (e.g. NCBI Gene / MeSH / dbSNP) " +
    "and character offsets, plus a de-duplicated per-type grouping. Every entity is one " +
    "PubTator actually resolved — nothing is invented; unrecognized input yields an honest " +
    "empty result. USE THIS FIRST to disambiguate the exact gene/disease/drug/variant tokens " +
    "in a claim before routing to the specific evidence engines below. Provide exactly one of " +
    "`pmids` or `text`.",
  inputSchema: {
    pmids: z
      .array(z.string())
      .min(1)
      .max(50)
      .optional()
      .describe("Up to 50 PubMed IDs to fetch pre-computed annotations for."),
    text: z
      .string()
      .min(1)
      .max(10_000)
      .optional()
      .describe("A free-text passage (max 10000 chars) to annotate on the fly."),
  },
  annotations: READ_ONLY,
  handler: postHandler("/api/bio/annotate", {
    pmids: z.array(z.string()).min(1).max(50).optional(),
    text: z.string().min(1).max(10_000).optional(),
  }, (data) => {
    const d = asRecord(data);
    const docs = Array.isArray(d.documents) ? d.documents : [];
    return `Annotated ${docs.length} document(s) from source "${String(d.source ?? "unknown")}".`;
  }),
});

// ── bio_safety_signal ──────────────────────────────────────────────────────
// Two modes: live { drug, event } against FAERS, or a pre-assembled { a,b,c,d } 2x2.
const bioSafetySignal = tool({
  name: "bio_safety_signal",
  title: "Pharmacovigilance Safety Signal (FAERS)",
  description:
    "Detect a drug–adverse-event safety signal using FDA FAERS spontaneous reports. " +
    "Two deterministic modes (no LLM in the numeric path): (1) live — provide `drug` and " +
    "`event` (e.g. drug=\"rofecoxib\", event=\"myocardial infarction\") to fetch the drug–event " +
    "2x2 from openFDA and compute disproportionality (PRR, ROR, chi-square with Yates, and the " +
    "Information Component with its IC025 lower bound); (2) offline — provide a pre-assembled " +
    "2x2 (`a`,`b`,`c`,`d`) to reproduce a published contingency table with zero network calls. " +
    "USE THIS to check whether a claimed adverse-event association is statistically supported in " +
    "post-marketing surveillance. A missing FAERS pair returns an honest found:false, never a " +
    "fabricated signal. Provide either {drug,event} or {a,b,c,d}.",
  inputSchema: {
    drug: z.string().min(1).max(200).optional().describe("Drug name (live FAERS mode)."),
    event: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe("Adverse event / MedDRA-style term (live FAERS mode)."),
    a: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe("2x2 cell a: reports with BOTH the drug and the event."),
    b: z.number().int().nonnegative().optional().describe("2x2 cell b: drug, not the event."),
    c: z.number().int().nonnegative().optional().describe("2x2 cell c: event, not the drug."),
    d: z.number().int().nonnegative().optional().describe("2x2 cell d: neither."),
  },
  annotations: READ_ONLY,
  handler: postHandler("/api/bio/safety-signal", {
    drug: z.string().min(1).max(200).optional(),
    event: z.string().min(1).max(200).optional(),
    a: z.number().int().nonnegative().optional(),
    b: z.number().int().nonnegative().optional(),
    c: z.number().int().nonnegative().optional(),
    d: z.number().int().nonnegative().optional(),
  }, (data) => {
    const d = asRecord(data);
    if (d.found === false) return "No FAERS reports found for this drug–event pair.";
    const signal = d.signal;
    return `Disproportionality signal: ${signal === undefined ? "computed" : String(signal)}.`;
  }),
});

// ── bio_genetic_association ────────────────────────────────────────────────
// disease is required; at least one of gene / variant must be present.
const bioGeneticAssociation = tool({
  name: "bio_genetic_association",
  title: "Genetic Association Verification (GWAS + ClinVar)",
  description:
    "Verify a claimed gene/variant–disease genetic association against the EBI GWAS Catalog and " +
    "NCBI ClinVar. Provide `disease` plus at least one of `gene` (symbol) or `variant` (rsID). " +
    "Returns a deterministic verdict decided by field-standard thresholds — genome_wide_significant " +
    "(p ≤ 5e-8), suggestive, reported_not_significant, clinvar_pathogenic, conflicting, or " +
    "no_association_found — with the supporting GWAS and ClinVar records and the minimum p-value. " +
    "No LLM is in the loop; an empty upstream response yields an honest no_association_found rather " +
    "than a guess. USE THIS to check whether a genetics claim (e.g. \"PCSK9 variants associate with " +
    "coronary artery disease\") holds at genome-wide significance.",
  inputSchema: {
    gene: z.string().min(1).max(64).optional().describe("Gene symbol, e.g. PCSK9."),
    variant: z.string().min(1).max(64).optional().describe("Variant rsID, e.g. rs11591147."),
    disease: z.string().min(2).max(200).describe("Disease / trait name (required)."),
  },
  annotations: READ_ONLY,
  handler: postHandler("/api/bio/genetic-association", {
    gene: z.string().min(1).max(64).optional(),
    variant: z.string().min(1).max(64).optional(),
    disease: z.string().min(2).max(200),
  }, (data) => {
    const d = asRecord(data);
    const sup = asRecord(d.supporting);
    const gwas = Array.isArray(sup.gwas) ? sup.gwas.length : 0;
    const clinvar = Array.isArray(sup.clinvar) ? sup.clinvar.length : 0;
    return `Verdict: ${String(d.verdict ?? "unknown")} (${gwas} GWAS, ${clinvar} ClinVar records).`;
  }),
});

// ── bio_variant_pathogenicity ──────────────────────────────────────────────
// At least one of rsId / hgvs / gene must be present.
const bioVariantPathogenicity = tool({
  name: "bio_variant_pathogenicity",
  title: "Variant Pathogenicity Verification (ClinVar)",
  description:
    "Verify a claimed variant clinical significance against NCBI ClinVar. Provide at least one of " +
    "`rsId`, `hgvs`, or `gene`, optionally scoped by `condition`, and optionally a " +
    "`claimedSignificance` (e.g. \"pathogenic\") to check against. Returns a deterministic verdict — " +
    "confirmed, overstated_certainty (the claim asserts pathogenic but ClinVar is a VUS/benign or a " +
    "low-star submission), conflicting, or not_found — with the highest ClinVar review-status " +
    "(star-rated) record. The verdict follows ClinVar's documented review-status→star scale; no LLM " +
    "is involved, and an empty response yields an honest not_found. USE THIS to check whether a " +
    "\"variant X is pathogenic for condition Y\" claim is actually supported at adequate review " +
    "confidence.",
  inputSchema: {
    rsId: z.string().min(1).max(64).optional().describe("dbSNP rsID, e.g. rs80357906."),
    hgvs: z.string().min(1).max(256).optional().describe("HGVS expression for the variant."),
    gene: z.string().min(1).max(64).optional().describe("Gene symbol to search within."),
    condition: z.string().min(1).max(200).optional().describe("Condition to scope the lookup to."),
    claimedSignificance: z
      .string()
      .min(1)
      .max(64)
      .optional()
      .describe("The clinical significance being claimed, e.g. pathogenic / likely benign."),
  },
  annotations: READ_ONLY,
  handler: postHandler("/api/bio/variant-pathogenicity", {
    rsId: z.string().min(1).max(64).optional(),
    hgvs: z.string().min(1).max(256).optional(),
    gene: z.string().min(1).max(64).optional(),
    condition: z.string().min(1).max(200).optional(),
    claimedSignificance: z.string().min(1).max(64).optional(),
  }, (data) => {
    const d = asRecord(data);
    const records = Array.isArray(d.records) ? d.records.length : 0;
    const best = asRecord(d.bestRecord);
    const star = best.starRating;
    return `Verdict: ${String(d.verdict ?? "unknown")} (${records} record(s)${
      star === undefined ? "" : `, best ${String(star)}★`
    }).`;
  }),
});

// ── bio_target_disease ─────────────────────────────────────────────────────
const bioTargetDisease = tool({
  name: "bio_target_disease",
  title: "Target–Disease Evidence (Open Targets)",
  description:
    "Aggregate target–disease association evidence from the Open Targets Platform. Provide `target` " +
    "(gene symbol, e.g. PCSK9) and `disease` (name, e.g. hypercholesterolemia). Resolves the Ensembl " +
    "gene id and EFO disease id, then returns Open Targets' deterministic association scores — overall " +
    "plus per-datatype (genetic, known-drug, literature, animal-model) — along with known drugs and " +
    "target tractability. Scores come straight from the API; no LLM touches the numbers. Set " +
    "`summarize` to true to additionally get a Claude-written plain-language summary that references " +
    "only the returned data (it never alters a score). USE THIS to gauge how well a therapeutic target " +
    "is supported for a given indication before pursuing it.",
  inputSchema: {
    target: z.string().min(1).max(100).describe("Target gene symbol, e.g. PCSK9."),
    disease: z.string().min(1).max(200).describe("Disease name, e.g. hypercholesterolemia."),
    summarize: z
      .boolean()
      .optional()
      .describe("If true, append a Claude plain-language summary of the deterministic scores."),
  },
  annotations: READ_ONLY,
  handler: async (args, client) => {
    try {
      const schema = z.object({
        target: z.string().min(1).max(100),
        disease: z.string().min(1).max(200),
        summarize: z.boolean().optional(),
      });
      const { target, disease, summarize } = schema.parse(args);
      const path = summarize
        ? "/api/bio/target-disease?summarize=true"
        : "/api/bio/target-disease";
      const data = await client.post<unknown>(path, { target, disease });
      const d = asRecord(data);
      const drugs = Array.isArray(d.knownDrugs) ? d.knownDrugs.length : 0;
      const summary = d.found === false
        ? `No Open Targets association resolved for ${target} × ${disease}.`
        : `Overall association score: ${String(d.overallScore ?? "n/a")} (${drugs} known drug(s)).`;
      return formatResult(summary, data);
    } catch (err) {
      return toErrorMessage(err);
    }
  },
});

export const biomedicalCoreTools: PaperTrailTool[] = [
  bioAnnotateEntities,
  bioSafetySignal,
  bioGeneticAssociation,
  bioVariantPathogenicity,
  bioTargetDisease,
];
