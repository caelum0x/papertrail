// Verification + fact-check MCP tools.
//
// These wrap PaperTrail's public claim-verification and fact-check endpoints. Every
// tool is a read-only analysis: it POSTs to the deployed API via PaperTrailClient and
// returns a human-readable summary followed by the full JSON payload. Field names and
// zod shapes mirror the corresponding app/api/*/route.ts exactly — no guessing.
//
// Endpoints covered:
//   verify_claim            -> POST /api/verify
//   verify_claim_batch      -> POST /api/verify/batch
//   verify_text_claims      -> POST /api/verify/text
//   meta_crosscheck         -> POST /api/meta-crosscheck
//   scientific_claim_eval   -> POST /api/scieval
//   fact_check_pipeline     -> POST /api/factcheck
//   fact_check_document     -> POST /api/fact-check
//   classify_citation       -> POST /api/citations/classify
//   audit_guideline         -> POST /api/guideline-audit
//   draft_with_evidence     -> POST /api/drafting

import { z } from "zod";
import type { PaperTrailClient } from "../client.js";
import { tool, formatResult, toErrorMessage, type PaperTrailTool } from "../registry.js";

// All tools here are read-only analyses that reach live external registries.
const READ_ONLY = { readOnlyHint: true, openWorldHint: true } as const;

// Shared study-input shape for meta_crosscheck, mirroring the StudyInputSchema in
// app/api/meta-crosscheck/route.ts (a point estimate + CI OR raw 2x2 counts).
const studyInput = z.object({
  label: z.string().min(1).max(200).describe("A short label for the study, e.g. its first-author + year."),
  measure: z.enum(["RR", "HR", "OR"]).describe("Ratio effect measure: RR (risk ratio), HR (hazard ratio), or OR (odds ratio)."),
  point: z.number().finite().positive().nullish().describe("Point estimate of the ratio (e.g. 0.72). Provide with CI, or use the 2x2 counts instead."),
  ciLower: z.number().finite().positive().nullish().describe("Lower bound of the confidence interval for the point estimate."),
  ciUpper: z.number().finite().positive().nullish().describe("Upper bound of the confidence interval for the point estimate."),
  ciPct: z.number().finite().gt(0).lt(100).nullish().describe("Confidence-interval width in percent (default 95 if omitted)."),
  events1: z.number().finite().nonnegative().nullish().describe("2x2 counts: events in the treatment/exposed arm."),
  total1: z.number().finite().nonnegative().nullish().describe("2x2 counts: total subjects in the treatment/exposed arm."),
  events2: z.number().finite().nonnegative().nullish().describe("2x2 counts: events in the control/unexposed arm."),
  total2: z.number().finite().nonnegative().nullish().describe("2x2 counts: total subjects in the control/unexposed arm."),
});

export const verificationTools: PaperTrailTool[] = [
  tool({
    name: "verify_claim",
    title: "Verify an efficacy claim against primary sources",
    description:
      "Verify a single clinical/efficacy claim (e.g. \"Drug X cut cardiovascular events by 30%\") against the actual " +
      "primary source. PaperTrail retrieves the best-matching PubMed / ClinicalTrials.gov record from its cache, " +
      "extracts the real finding, and reports a discrepancy type, trust score, and the exact flagged spans that map " +
      "back to the source text. Also returns a deterministic effect-size cross-check, a registry check against the " +
      "trial's own registered statistics (for ClinicalTrials.gov sources), and corroborating sources. Use this when " +
      "you have one claim and want to know whether it is faithful to the literature, overstated, or unsupported. " +
      "If no confident source is found it returns an honest 'no_support_found' rather than a forced match.",
    inputSchema: {
      claim: z
        .string()
        .min(10)
        .max(2000)
        .describe("The single efficacy/clinical claim to verify (10-2000 characters)."),
      source_hint: z
        .string()
        .optional()
        .describe("Optional DOI / PMID / NCT id the claim actually cited, to pin verification to that source."),
    },
    annotations: READ_ONLY,
    handler: async (args: Record<string, unknown>, client: PaperTrailClient): Promise<string> => {
      try {
        const input = z
          .object({ claim: z.string().min(10).max(2000), source_hint: z.string().optional() })
          .parse(args);
        const data = await client.post("/api/verify", input);
        const r = data as {
          status?: string;
          verification?: { discrepancy_type?: string; trust_score?: number };
          source?: { title?: string };
        } | null;
        const status = r?.status ?? "unknown";
        const disc = r?.verification?.discrepancy_type;
        const score = r?.verification?.trust_score;
        const summary =
          status === "verified"
            ? `Verified against "${r?.source?.title ?? "source"}": ${disc ?? "n/a"} (trust score ${score ?? "n/a"}).`
            : `Result: ${status}.`;
        return formatResult(summary, data);
      } catch (err) {
        return toErrorMessage(err);
      }
    },
  }),

  tool({
    name: "verify_claim_batch",
    title: "Verify many claims (or a whole passage) at once",
    description:
      "Verify up to 5 claims in one call. Either paste a block of prose as `text` (PaperTrail splits it into " +
      "individual sentences/claims) or supply an explicit `claims` array. Each claim runs the full verification " +
      "chain and returns its own verdict; the response reports how many were detected and whether the list was " +
      "truncated to the 5-claim cap. Use this to audit an abstract, a press release paragraph, or a slide of " +
      "bullet-point claims in a single pass rather than calling verify_claim repeatedly.",
    inputSchema: {
      text: z
        .string()
        .optional()
        .describe("A passage to split into individual claims. Provide this OR `claims`; if both, `claims` wins."),
      claims: z
        .array(z.string())
        .optional()
        .describe("An explicit list of claims to verify. Only the first 5 are processed."),
    },
    annotations: READ_ONLY,
    handler: async (args: Record<string, unknown>, client: PaperTrailClient): Promise<string> => {
      try {
        const input = z
          .object({ text: z.string().optional(), claims: z.array(z.string()).optional() })
          .refine((v) => Boolean(v.text) || (v.claims && v.claims.length > 0), {
            message: "Provide either `text` or a non-empty `claims` array.",
          })
          .parse(args);
        const data = await client.post("/api/verify/batch", input);
        const r = data as { total_detected?: number; truncated?: boolean; results?: unknown[] } | null;
        const processed = Array.isArray(r?.results) ? r?.results.length : 0;
        const summary = `Processed ${processed} claim(s) of ${r?.total_detected ?? processed} detected${
          r?.truncated ? " (truncated to the 5-claim cap)" : ""
        }.`;
        return formatResult(summary, data);
      } catch (err) {
        return toErrorMessage(err);
      }
    },
  }),

  tool({
    name: "verify_text_claims",
    title: "Verify a claim against your own pasted source text",
    description:
      "Bring-your-own-source verification: check a claim against an arbitrary block of source text you paste " +
      "(an abstract, a results paragraph, an unpublished draft) instead of PaperTrail's retrieval cache. It extracts " +
      "the finding from your text, grounds every flagged span verbatim to it, and runs the deterministic effect-size " +
      "cross-check. Use this when you already know the exact source and want to confirm a claim is faithful to it, " +
      "or when the source is not in any public registry.",
    inputSchema: {
      claim: z
        .string()
        .min(10)
        .describe("The claim to verify (at least 10 characters)."),
      source_text: z
        .string()
        .min(40)
        .max(20000)
        .describe("The source text to verify against (40-20000 characters), e.g. an abstract or results passage."),
    },
    annotations: READ_ONLY,
    handler: async (args: Record<string, unknown>, client: PaperTrailClient): Promise<string> => {
      try {
        const input = z
          .object({ claim: z.string().min(10), source_text: z.string().min(40).max(20000) })
          .parse(args);
        const data = await client.post("/api/verify/text", input);
        const r = data as { verification?: { discrepancy_type?: string; trust_score?: number } } | null;
        const summary = `Verified against pasted source: ${
          r?.verification?.discrepancy_type ?? "n/a"
        } (trust score ${r?.verification?.trust_score ?? "n/a"}).`;
        return formatResult(summary, data);
      } catch (err) {
        return toErrorMessage(err);
      }
    },
  }),

  tool({
    name: "meta_crosscheck",
    title: "Pool study effects and cross-check the meta-analysis",
    description:
      "Run a deterministic random-effects meta-analysis over 2+ study-level effects and (when the PyMARE reference " +
      "backend is enabled) cross-check PaperTrail's pooled estimate against an independent reference implementation, " +
      "reporting whether the two agree. No LLM is involved — every number is a closed-form computation. Each study is " +
      "given EITHER a point estimate + confidence interval OR raw 2x2 event counts, with a ratio measure (RR/HR/OR). " +
      "Use this to pool trial results yourself and confirm a published pooled effect is reproducible.",
    inputSchema: {
      studies: z
        .array(studyInput)
        .min(2)
        .max(200)
        .describe("At least two studies to pool. Each provides a point+CI or full 2x2 counts, plus its ratio measure."),
    },
    annotations: READ_ONLY,
    handler: async (args: Record<string, unknown>, client: PaperTrailClient): Promise<string> => {
      try {
        const input = z.object({ studies: z.array(studyInput).min(2).max(200) }).parse(args);
        const data = await client.post("/api/meta-crosscheck", input);
        const r = data as { ours?: { k?: number } | null; agree?: boolean | null; reference?: unknown } | null;
        const k = r?.ours?.k;
        const summary =
          r?.reference != null
            ? `Pooled ${k ?? "?"} studies; reference cross-check ${r?.agree ? "agrees" : "disagrees"}.`
            : `Pooled ${k ?? "?"} studies (no independent reference available).`;
        return formatResult(summary, data);
      } catch (err) {
        return toErrorMessage(err);
      }
    },
  }),

  tool({
    name: "scientific_claim_eval",
    title: "SciFact-style SUPPORTS / REFUTES / NEI verdict",
    description:
      "Evaluate a scientific claim in the SciFact / MultiVerS style: assign a SUPPORTS, REFUTES, or NEI (not enough " +
      "info) label and select the rationale sentences from an abstract that justify it. Each rationale is grounded " +
      "back to the abstract verbatim; ungroundable rationales are dropped, and a non-NEI label left with no surviving " +
      "rationale is honestly downgraded to NEI. If you omit `abstract`, PaperTrail retrieves a matching cached source; " +
      "if none is confident it returns 'no_source_found'. Use this for label-style entailment checks against a " +
      "specific abstract, as opposed to the effect-size-aware verify_claim.",
    inputSchema: {
      claim: z
        .string()
        .describe("The scientific claim to label as SUPPORTS / REFUTES / NEI."),
      abstract: z
        .string()
        .optional()
        .describe("Optional abstract to evaluate the claim against. If omitted, a matching cached source is retrieved."),
    },
    annotations: READ_ONLY,
    handler: async (args: Record<string, unknown>, client: PaperTrailClient): Promise<string> => {
      try {
        const input = z.object({ claim: z.string(), abstract: z.string().optional() }).parse(args);
        const data = await client.post("/api/scieval", input);
        const r = data as {
          status?: string;
          verification?: { label?: string; rationales?: unknown[] };
        } | null;
        const summary =
          r?.status === "no_source_found"
            ? "No confident source abstract found for this claim."
            : `Label: ${r?.verification?.label ?? "n/a"} with ${
                Array.isArray(r?.verification?.rationales) ? r?.verification?.rationales.length : 0
              } grounded rationale(s).`;
        return formatResult(summary, data);
      } catch (err) {
        return toErrorMessage(err);
      }
    },
  }),

  tool({
    name: "fact_check_pipeline",
    title: "Full decompose-and-verify fact-check of a passage",
    description:
      "Run PaperTrail's multi-step fact-verification pipeline (decompose -> checkworthy -> query-gen -> retrieve over " +
      "cached sources -> grounded verify -> aggregate) over a block of natural-language text. It breaks the text into " +
      "atomic claims, filters to the check-worthy ones, verifies each against a real source span, and returns per-claim " +
      "verdicts plus an overall factuality summary. Use this for narrative text (an intro paragraph, a discussion " +
      "section) where claims are embedded in prose and you want an end-to-end factuality report.",
    inputSchema: {
      text: z
        .string()
        .describe("The block of natural-language text to decompose and fact-check."),
    },
    annotations: READ_ONLY,
    handler: async (args: Record<string, unknown>, client: PaperTrailClient): Promise<string> => {
      try {
        const input = z.object({ text: z.string() }).parse(args);
        const data = await client.post("/api/factcheck", input);
        const r = data as {
          summary?: { num_claims?: number; num_checkworthy?: number; num_verified?: number; factuality?: number };
        } | null;
        const s = r?.summary;
        const summary = `Fact-check: ${s?.num_verified ?? 0}/${s?.num_checkworthy ?? 0} check-worthy claims verified (${
          s?.num_claims ?? 0
        } total); factuality ${s?.factuality ?? "n/a"}.`;
        return formatResult(summary, data);
      } catch (err) {
        return toErrorMessage(err);
      }
    },
  }),

  tool({
    name: "fact_check_document",
    title: "Entailment fact-check of (claim, document) pairs",
    description:
      "Supplementary entailment fact-check: given up to 20 (claim, document) pairs, ask PaperTrail's MiniCheck engine " +
      "whether each claim is *supported* (entailed) by its paired document. This complements verbatim-span grounding " +
      "with a natural-language-inference view. When the MiniCheck engine is disabled, the response is an honest " +
      "checked:false rather than fabricated verdicts. Use this when you already have claim/evidence pairs and want a " +
      "fast entailment signal for each.",
    inputSchema: {
      pairs: z
        .array(
          z.object({
            claim: z.string().max(2000).describe("The claim to test for entailment (max 2000 characters)."),
            doc: z.string().max(50000).describe("The document the claim is checked against (max 50000 characters)."),
          })
        )
        .min(1)
        .max(20)
        .describe("1-20 (claim, doc) pairs to entailment-check."),
    },
    annotations: READ_ONLY,
    handler: async (args: Record<string, unknown>, client: PaperTrailClient): Promise<string> => {
      try {
        const input = z
          .object({
            pairs: z
              .array(z.object({ claim: z.string().max(2000), doc: z.string().max(50000) }))
              .min(1)
              .max(20),
          })
          .parse(args);
        const data = await client.post("/api/fact-check", input);
        const r = data as { checked?: boolean; results?: { supported?: boolean }[] } | null;
        if (r?.checked === false) {
          return formatResult("Entailment engine unavailable — not checked (checked:false).", data);
        }
        const supported = Array.isArray(r?.results) ? r?.results.filter((x) => x.supported).length : 0;
        const totalPairs = Array.isArray(r?.results) ? r?.results.length : 0;
        return formatResult(`${supported}/${totalPairs} pair(s) supported (entailed).`, data);
      } catch (err) {
        return toErrorMessage(err);
      }
    },
  }),

  tool({
    name: "classify_citation",
    title: "Classify a citation's stance (supporting / contrasting / mentioning)",
    description:
      "Smart-citation classifier (Scite-style). Given a citing passage and a one-sentence summary of the cited work's " +
      "claim, PaperTrail classifies the citation STANCE — supporting, contrasting, or mentioning — and extracts the " +
      "exact citation-context sentence, grounded verbatim to the citing text. Use this to understand *how* one paper " +
      "cites another (does it agree, dispute, or merely note it) rather than whether a claim is true.",
    inputSchema: {
      citing_text: z
        .string()
        .min(20)
        .max(6000)
        .describe("The paragraph from the citing paper that contains the citation (20-6000 characters)."),
      cited_claim: z
        .string()
        .min(10)
        .max(2000)
        .describe("A one-sentence summary of the cited work's finding (10-2000 characters)."),
    },
    annotations: READ_ONLY,
    handler: async (args: Record<string, unknown>, client: PaperTrailClient): Promise<string> => {
      try {
        const input = z
          .object({
            citing_text: z.string().min(20).max(6000),
            cited_claim: z.string().min(10).max(2000),
          })
          .parse(args);
        const data = await client.post("/api/citations/classify", input);
        const r = data as {
          status?: string;
          classification?: { stance?: string; confidence?: number };
        } | null;
        const summary =
          r?.status === "ungroundable"
            ? "Citation context could not be grounded to the citing text (ungroundable)."
            : `Stance: ${r?.classification?.stance ?? "n/a"} (confidence ${r?.classification?.confidence ?? "n/a"}).`;
        return formatResult(summary, data);
      } catch (err) {
        return toErrorMessage(err);
      }
    },
  }),

  tool({
    name: "audit_guideline",
    title: "Audit a guideline or press release claim-by-claim",
    description:
      "Paste a clinical guideline, press release, or marketing document and get a claim-by-claim audit: PaperTrail " +
      "extracts each efficacy claim with Claude and verifies it against primary sources, then summarises how many " +
      "claims are accurate, overstated, or unsupported. The numeric verdicts come from a deterministic verification " +
      "loop, not an LLM. Use this to screen a whole document for exaggerated or unsupported efficacy claims in one " +
      "pass; paste the efficacy/results section if the full document exceeds the 24000-character cap.",
    inputSchema: {
      text: z
        .string()
        .min(40)
        .max(24000)
        .describe("The document to audit (40-24000 characters), e.g. a guideline or press-release section."),
    },
    annotations: READ_ONLY,
    handler: async (args: Record<string, unknown>, client: PaperTrailClient): Promise<string> => {
      try {
        const input = z.object({ text: z.string().min(40).max(24000) }).parse(args);
        const data = await client.post("/api/guideline-audit", input);
        const r = data as {
          summary?: { total?: number; overstated?: number; unsupported?: number; accurate?: number };
        } | null;
        const s = r?.summary;
        const summary = `Audited ${s?.total ?? 0} claim(s): ${s?.accurate ?? 0} accurate, ${
          s?.overstated ?? 0
        } overstated, ${s?.unsupported ?? 0} unsupported.`;
        return formatResult(summary, data);
      } catch (err) {
        return toErrorMessage(err);
      }
    },
  }),

  tool({
    name: "draft_with_evidence",
    title: "Draft an evidence-grounded section that self-corrects",
    description:
      "Evidence-grounded draft assistant. Give it a topic (a claim or short passage) and an optional section type, and " +
      "PaperTrail retrieves verified evidence, drafts the section with Claude grounded in that evidence, then " +
      "self-corrects every efficacy sentence against the verified findings. The response reports which sentences were " +
      "grounded vs corrected and whether the underlying evidence was sufficient. Use this to produce a first draft " +
      "whose efficacy statements are already checked against the literature. This is a read-only analysis: nothing is " +
      "saved to your workspace.",
    inputSchema: {
      topic: z
        .string()
        .min(10)
        .max(2000)
        .describe("The claim or short passage to draft around (10-2000 characters)."),
      section: z
        .string()
        .optional()
        .describe("Optional section type to shape the draft (e.g. an introduction or results section)."),
    },
    annotations: READ_ONLY,
    handler: async (args: Record<string, unknown>, client: PaperTrailClient): Promise<string> => {
      try {
        const input = z
          .object({ topic: z.string().min(10).max(2000), section: z.string().optional() })
          .parse(args);
        const data = await client.post("/api/drafting", input);
        const r = data as {
          section?: string;
          summary?: { totalSentences?: number; efficacyClaims?: number; grounded?: number; corrected?: number };
          evidence?: { sufficient?: boolean };
        } | null;
        const s = r?.summary;
        const summary = `Drafted ${r?.section ?? "section"}: ${s?.totalSentences ?? 0} sentence(s), ${
          s?.grounded ?? 0
        } grounded, ${s?.corrected ?? 0} corrected; evidence ${
          r?.evidence?.sufficient ? "sufficient" : "insufficient"
        }.`;
        return formatResult(summary, data);
      } catch (err) {
        return toErrorMessage(err);
      }
    },
  }),
];
