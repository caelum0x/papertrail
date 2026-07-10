// Biology-domain evidence tools — the ontology + finding surface.
//
// Companion to biomedicalCore.ts / biomedicalExtra.ts. Same pattern: thin, typed,
// read-only wrappers over deterministic PaperTrail endpoints. This file holds the
// domain-layer engines that sit on the shared bio ontology: verbatim-grounded
// bioinformatics-finding verification, curated cell-marker lookup, deterministic
// entity canonicalization, and variant→outcome verification.
//
// MOAT: no LLM decides any verdict or number here — every quoted span is grounded
// to a verbatim substring of the provided source, and unresolved entities degrade
// to honest empty results rather than fabricated answers.
//
// Field names below match the live route bodies exactly (lib/bio/bioinformatics.schemas.ts).

import { z } from "zod";
import type { PaperTrailClient } from "../client.js";
import { tool, formatResult, toErrorMessage } from "../registry.js";
import type { PaperTrailTool } from "../registry.js";

function asRecord(data: unknown): Record<string, unknown> {
  return data && typeof data === "object" ? (data as Record<string, unknown>) : {};
}

// Validate args, POST body to a fixed path, format the reply.
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

const READ_ONLY = { readOnlyHint: true, openWorldHint: true } as const;

// Shared effect-size shape (matches EffectSizeSchema): metric + value + optional CI.
const effectSizeShape = z
  .object({
    metric: z.enum(["AUC", "HR", "logFC"]),
    value: z.number().finite(),
    ci_lower: z.number().finite().optional(),
    ci_upper: z.number().finite().optional(),
  })
  .describe("The claimed effect size: metric (AUC 0.5-1, HR <1 protective, logFC signed), value, optional 95% CI.");

// ── verify_bioinformatics_finding ────────────────────────────────────────────
const verifyBioinformaticsFinding = tool({
  name: "verify_bioinformatics_finding",
  title: "Verify a Bioinformatics Finding",
  description:
    "Verify a structured bioinformatics finding (e.g. a scRNA-seq / signature claim) against the exact " +
    "source passage it is drawn from. Provide `assertion` (the claim, e.g. \"CD8 memory/exhausted ratio " +
    "stratifies ICB responders, AUC 0.86\"), the claimed `markerGenes` + `cellType`, the `effectSize`, the " +
    "study `population`, and `sourceText` (the verbatim abstract/results passage). Runs deterministic rule " +
    "engines — marker canonicalization vs curated panels, effect-size sanity (AUC in [0.5,1], CI contains " +
    "the point estimate, direction vs claimed benefit), and (when applicable) variant→outcome and " +
    "dose-response — and grounds every quoted number to a VERBATIM substring of sourceText; any number it " +
    "cannot locate is DROPPED and counted. Returns a deterministic verdict (supported | overstated | " +
    "partially_supported | unsupported | insufficient_evidence), the per-check `signals`, grounded " +
    "`flagged_spans`, canonicalized markers, and `droppedUngrounded`. No LLM is in the numeric/verdict path.",
  inputSchema: {
    assertion: z.string().min(1).max(2_000).describe("The finding / claim to verify."),
    markerGenes: z
      .array(z.string().min(1).max(50))
      .max(200)
      .optional()
      .describe("Claimed marker genes underpinning the finding, e.g. [\"IL7R\",\"TCF7\",\"CCR7\"]."),
    cellType: z.string().min(1).max(200).optional().describe("Claimed cell type, e.g. \"CD8 memory-like\"."),
    effectSize: effectSizeShape.optional(),
    population: z.string().min(1).max(500).optional().describe("Study population, e.g. \"melanoma ICB cohort\"."),
    sourceText: z
      .string()
      .min(1)
      .max(200_000)
      .describe("The verbatim source passage every quoted number must appear in."),
  },
  annotations: READ_ONLY,
  handler: postHandler(
    "/api/bio/verify-finding",
    {
      assertion: z.string().min(1).max(2_000),
      markerGenes: z.array(z.string().min(1).max(50)).max(200).optional(),
      cellType: z.string().min(1).max(200).optional(),
      effectSize: effectSizeShape.optional(),
      population: z.string().min(1).max(500).optional(),
      sourceText: z.string().min(1).max(200_000),
    },
    (data) => {
      const d = asRecord(data);
      const signals = Array.isArray(d.signals) ? d.signals.length : 0;
      const dropped = typeof d.droppedUngrounded === "number" ? d.droppedUngrounded : 0;
      return `Verdict: ${String(d.verdict ?? "unknown")} across ${signals} check(s); ${dropped} number(s) dropped as ungroundable.`;
    }
  ),
});

// ── check_marker_panel ───────────────────────────────────────────────────────
const checkMarkerPanel = tool({
  name: "check_marker_panel",
  title: "Check a Cell-Type Marker Panel",
  description:
    "Check whether one or more genes are documented markers of a cell type against PaperTrail's curated " +
    "cell_marker_panels (CellMarker 2.0 / PanglaoDB, with direction + tissue + PMID). Provide `markerGenes` " +
    "(one or more symbols, e.g. [\"IL7R\",\"TCF7\"]) and `cellType` (label, e.g. \"CD8 memory-like\"). Each " +
    "gene is resolved to a canonical ontology term (deterministic, no LLM) and checked for registered " +
    "membership + direction; a gene that is not a marker, or is registered in the opposite direction, is " +
    "flagged as overstated. An unresolved gene or a cell type with no curated panel yields an honest empty " +
    "result — never a fabricated marker relationship. USE THIS to confirm a \"these genes mark this cell " +
    "type\" claim against real references.",
  inputSchema: {
    markerGenes: z
      .array(z.string().min(1).max(50))
      .min(1)
      .max(200)
      .describe("Claimed marker gene symbols, e.g. [\"IL7R\",\"TCF7\",\"CCR7\"]."),
    cellType: z.string().min(1).max(200).describe("Cell-type label, e.g. \"CD8 memory-like\"."),
  },
  annotations: READ_ONLY,
  handler: postHandler(
    "/api/bio/marker-check",
    {
      markerGenes: z.array(z.string().min(1).max(50)).min(1).max(200),
      cellType: z.string().min(1).max(200),
    },
    (data) => {
      const d = asRecord(data);
      const signals = Array.isArray(d.signals) ? d.signals.length : 0;
      return `Marker check: verdict ${String(d.verdict ?? "unknown")} over ${signals} gene(s).`;
    }
  ),
});

// ── canonicalize_entity ──────────────────────────────────────────────────────
const canonicalizeEntity = tool({
  name: "canonicalize_entity",
  title: "Canonicalize a Biomedical Entity",
  description:
    "Resolve a free-text biomedical surface form to its canonical ontology term. Provide `surface` (the " +
    "term to resolve, e.g. \"HER2\" or \"heart attack\") and optionally `type` (a term-type filter to " +
    "disambiguate). The surface is normalized (lowercase, collapsed whitespace) and matched EXACTLY " +
    "against curated ontology synonyms — a hit returns the CURIE, canonical label, ontology, term type, a " +
    "score of 1.0, and cross-references (xrefs); a miss returns null. No LLM is in the entity-linking " +
    "path, and an unrecognized surface yields an honest null rather than a fabricated id.",
  inputSchema: {
    surface: z.string().min(1).max(200).describe("The surface form to resolve, e.g. HER2."),
    type: z
      .string()
      .min(1)
      .max(64)
      .optional()
      .describe("Optional term-type filter to disambiguate the match."),
  },
  annotations: READ_ONLY,
  handler: postHandler(
    "/api/entities/canonicalize",
    {
      surface: z.string().min(1).max(200),
      type: z.string().min(1).max(64).optional(),
    },
    (data) => {
      const d = asRecord(data);
      if (d.curie === undefined || d.curie === null) {
        return "No canonical term resolved (honest miss).";
      }
      return `Resolved to ${String(d.curie)} (${String(d.canonicalLabel ?? "?")}) in ${String(d.ontology ?? "?")}.`;
    }
  ),
});

// ── verify_variant_outcome ───────────────────────────────────────────────────
const verifyVariantOutcome = tool({
  name: "verify_variant_outcome",
  title: "Verify a Variant→Outcome Claim",
  description:
    "Verify a claimed variant→outcome direction against ClinVar's registered clinical significance. " +
    "Provide at least one variant identifier — `rsId` (e.g. \"rs334\"), `hgvs`, or `gene` — optionally " +
    "narrowed by `condition`, plus the `claimedDirection` (\"protective\" or \"risk\"). Returns a " +
    "deterministic verdict on whether the claimed direction is consistent with the registered ClinVar " +
    "significance, with the supporting records. No LLM is in the verdict path; an empty upstream response " +
    "yields an honest not_found/insufficient result rather than a guess.",
  inputSchema: {
    rsId: z.string().min(1).max(50).optional().describe("Variant rsID, e.g. rs334."),
    hgvs: z.string().min(1).max(200).optional().describe("HGVS variant notation."),
    gene: z.string().min(1).max(50).optional().describe("Gene symbol to scope the locus."),
    condition: z.string().min(1).max(200).optional().describe("Optional condition/phenotype to scope."),
    claimedDirection: z
      .enum(["protective", "risk"])
      .describe("The claimed clinical direction: protective (reduces risk) or risk (increases risk)."),
  },
  annotations: READ_ONLY,
  handler: postHandler(
    "/api/bio/variant-outcome",
    {
      rsId: z.string().min(1).max(50).optional(),
      hgvs: z.string().min(1).max(200).optional(),
      gene: z.string().min(1).max(50).optional(),
      condition: z.string().min(1).max(200).optional(),
      claimedDirection: z.enum(["protective", "risk"]),
    },
    (data) => {
      const d = asRecord(data);
      return `Verdict: ${String(d.verdict ?? "unknown")}.`;
    }
  ),
});

export const bioDomainTools: PaperTrailTool[] = [
  verifyBioinformaticsFinding,
  checkMarkerPanel,
  canonicalizeEntity,
  verifyVariantOutcome,
];
