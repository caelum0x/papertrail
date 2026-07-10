// Deterministic PHARMACOGENOMIC ANNOTATION VERIFICATION over PharmGKB / ClinPGx.
//
// PaperTrail's moat is DETERMINISTIC biology on real open data with NO LLM in the
// numeric/decision path. This module answers one question about a claim like
// "variant CYP2C19*2 affects response to clopidogrel": does PharmGKB actually carry
// a clinical annotation for that gene/variant × drug, and at what field-standard
// EVIDENCE LEVEL? The verdict is a pure function of the PharmGKB level ordering
// (1A > 1B > 2A > 2B > 3 > 4) — nothing is inferred, weighted, or fabricated.
//
// Every network call goes through a single INJECTABLE fetcher (`PharmGkbDeps`)
// mirroring lib/bio/openTargets.ts / lib/ingest/searchAndCache.ts, so the tests run
// fully offline against mocked PharmGKB responses — no live network in the suite.
//
// On ANY upstream failure we return an HONEST empty result (verdict: not_found, no
// annotations) rather than a made-up level — a wrong "confident" PGx call is worse
// than an honest "couldn't verify" (CLAUDE.md no_support_found principle).
//
// ATTRIBUTION / LICENSE: PharmGKB & ClinPGx clinical-annotation content is licensed
// CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/). Anything that
// redistributes the annotation text this module returns MUST attribute
// PharmGKB/ClinPGx and share alike. The `attribution` field on the result carries
// this obligation in-band. We do NOT use DrugBank or DisGeNET here.

import {
  ClinicalAnnotation,
  ClinicalAnnotationSchema,
  PGX_EVIDENCE_LEVELS,
  PgxEvidenceLevel,
  PgxPhenotypeCategory,
  PgxVerdict,
  PgxVerificationResult,
} from "./pharmgkb.schemas";

// PharmGKB / ClinPGx REST API base (https://api.pharmgkb.org/v1/).
const PHARMGKB_BASE = "https://api.pharmgkb.org/v1";

// Bound requests so a hung upstream never wedges a serverless invocation.
const REQUEST_TIMEOUT_MS = 12_000;
// Cap the annotations we surface so a prolific drug (e.g. warfarin has ~90) can't
// balloon the response payload.
const MAX_ANNOTATIONS = 50;

// The CC BY-SA 4.0 attribution string surfaced on every result. Redistributing the
// returned annotation text obliges attribution + share-alike (see file header).
export const PHARMGKB_ATTRIBUTION =
  "Clinical annotation data from PharmGKB / ClinPGx (https://www.pharmgkb.org), " +
  "licensed CC BY-SA 4.0. Attribution and share-alike required on redistribution.";

// --- Injectable fetch layer ----------------------------------------------------

// A minimal injectable fetcher: given a fully-formed URL, return the parsed JSON
// payload (or null on any failure). The default hits the live PharmGKB REST API;
// tests pass a deterministic stub so no real network call is made.
export type JsonFetcher = (url: string) => Promise<unknown | null>;

export interface PharmGkbDeps {
  fetchJson: JsonFetcher;
}

const defaultFetchJson: JsonFetcher = async (url: string) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    // PharmGKB answers 404 with {status:"fail"} for "no results matching criteria" —
    // a legitimate empty, not an error. Any non-2xx here means "no data", which the
    // callers treat as an honest empty rather than a fabricated annotation.
    if (!res.ok) return null;
    return await res.json();
  } catch {
    // Network error / timeout / bad JSON — honest empty, never a fabrication.
    return null;
  } finally {
    clearTimeout(timer);
  }
};

const defaultDeps: PharmGkbDeps = { fetchJson: defaultFetchJson };

// --- Safe extractors ------------------------------------------------------------
// Pull values out of the untyped REST payload without ever throwing. A missing or
// malformed field degrades to null, never a fabricated value.

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function str(v: unknown): string | null {
  if (typeof v === "string") {
    const t = v.trim();
    return t.length > 0 ? t : null;
  }
  return null;
}

// --- Normalization: PharmGKB REST record -> ClinicalAnnotation ------------------

// Map PharmGKB annotation `types` (e.g. "Dosage", "Metabolism/PK", "Efficacy",
// "Toxicity", "Other") onto our phenotypeCategory vocabulary. PharmGKB tags an
// annotation with one or more types; we surface the FIRST recognized one, preferring
// the most clinically actionable when several are present. Unknown → null (never
// coerced), so we don't fabricate a category the data didn't assert.
const TYPE_TO_CATEGORY: Record<string, PgxPhenotypeCategory> = {
  efficacy: "efficacy",
  toxicity: "toxicity",
  dosage: "dosage",
  "metabolism/pk": "metabolism",
  metabolism: "metabolism",
  other: "other",
};

// Preference order when an annotation carries multiple types: toxicity and efficacy
// are the most decision-relevant for a claim, then dosage, then metabolism, then other.
const CATEGORY_PREFERENCE: PgxPhenotypeCategory[] = [
  "toxicity",
  "efficacy",
  "dosage",
  "metabolism",
  "other",
];

function extractPhenotypeCategory(types: unknown): PgxPhenotypeCategory | null {
  const found = new Set<PgxPhenotypeCategory>();
  for (const t of asArray(types)) {
    const key = str(t)?.toLowerCase();
    if (!key) continue;
    const cat = TYPE_TO_CATEGORY[key];
    if (cat) found.add(cat);
  }
  for (const c of CATEGORY_PREFERENCE) {
    if (found.has(c)) return c;
  }
  return null;
}

// PharmGKB levelOfEvidence.term is exactly one of our canonical level strings. We
// accept it ONLY if it matches the documented vocabulary — an unrecognized level is
// null (honest "unknown strength"), never coerced up or down.
const LEVEL_SET = new Set<string>(PGX_EVIDENCE_LEVELS);

function extractEvidenceLevel(levelOfEvidence: unknown): PgxEvidenceLevel | null {
  const term = str(asRecord(levelOfEvidence)?.term);
  if (term && LEVEL_SET.has(term)) return term as PgxEvidenceLevel;
  return null;
}

// The gene symbol lives under location.genes[].symbol.
function extractGene(location: unknown): string | null {
  const genes = asArray(asRecord(location)?.genes);
  for (const g of genes) {
    const symbol = str(asRecord(g)?.symbol);
    if (symbol) return symbol;
  }
  return null;
}

// The variant/allele: prefer the rsID, then the display name (which can be a
// star-allele or genotype), then the linked variant symbol.
function extractVariant(location: unknown): string | null {
  const loc = asRecord(location);
  return (
    str(loc?.rsid) ??
    str(loc?.displayName) ??
    str(asRecord(loc?.variant)?.symbol)
  );
}

// The first related chemical's name is the drug the annotation concerns.
function extractDrug(relatedChemicals: unknown): string | null {
  for (const c of asArray(relatedChemicals)) {
    const name = str(asRecord(c)?.name);
    if (name) return name;
  }
  return null;
}

// A guideline label if PharmGKB attaches one (CPIC / DPWG / FDA). Null when none.
function extractGuideline(relatedGuidelines: unknown): string | null {
  for (const g of asArray(relatedGuidelines)) {
    const name = str(asRecord(g)?.name);
    if (name) return name;
  }
  return null;
}

// The annotation summary: prefer the annotation `name` (a compact human title like
// "rs4244285 (CYP2C19); clopidogrel (level 1A Efficacy)"), else the first allele
// phenotype text. Returned VERBATIM from PharmGKB.
function extractSummary(raw: Record<string, unknown>): string | null {
  const name = str(raw.name);
  if (name) return name;
  for (const p of asArray(raw.allelePhenotypes)) {
    const phenotype = str(asRecord(p)?.phenotype);
    if (phenotype) return phenotype;
  }
  return null;
}

/**
 * Normalize one raw PharmGKB clinical-annotation record into a ClinicalAnnotation.
 * Every field degrades to null on absence — a partial record still contributes what
 * it has, and the result is Zod-validated before it escapes this module.
 */
export function normalizeClinicalAnnotation(raw: unknown): ClinicalAnnotation {
  const rec = asRecord(raw) ?? {};
  const annotation: ClinicalAnnotation = {
    annotationId: str(rec.accessionId) ?? str(rec.id) ?? null,
    gene: extractGene(rec.location),
    variant: extractVariant(rec.location),
    drug: extractDrug(rec.relatedChemicals),
    phenotypeCategory: extractPhenotypeCategory(rec.types),
    evidenceLevel: extractEvidenceLevel(rec.levelOfEvidence),
    guideline: extractGuideline(rec.relatedGuidelines),
    summary: extractSummary(rec),
  };
  // Defensive: validate the shape before returning it.
  return ClinicalAnnotationSchema.parse(annotation);
}

// --- Query construction ---------------------------------------------------------

// Build the PharmGKB clinicalAnnotation query URL. The drug is required (keyed on
// relatedChemicals.name); gene and variant further narrow via location.genes.symbol
// and location.displayName. `view=max` returns the full nested annotation objects.
function buildAnnotationUrl(query: {
  gene?: string;
  variant?: string;
  drug: string;
}): string {
  const params = new URLSearchParams();
  params.set("relatedChemicals.name", query.drug);
  if (query.gene) params.set("location.genes.symbol", query.gene);
  if (query.variant) params.set("location.displayName", query.variant);
  params.set("view", "max");
  return `${PHARMGKB_BASE}/data/clinicalAnnotation?${params.toString()}`;
}

// PharmGKB wraps results as { status, data: [...] }. Pull the data array defensively;
// a fail/empty envelope yields [].
function extractDataArray(payload: unknown): unknown[] {
  const rec = asRecord(payload);
  if (!rec) return [];
  return asArray(rec.data);
}

/**
 * Look up PharmGKB clinical annotations for a gene/variant × drug. Returns the
 * normalized annotations — or an EMPTY array when nothing matches or the API is
 * unavailable (never a fabricated hit). Offline-testable via injected deps.fetchJson.
 */
export async function lookupClinicalAnnotation(
  query: { gene?: string; variant?: string; drug: string },
  deps: PharmGkbDeps = defaultDeps
): Promise<ClinicalAnnotation[]> {
  const drug = query.drug?.trim();
  if (!drug) return [];
  const gene = query.gene?.trim() || undefined;
  const variant = query.variant?.trim() || undefined;

  const payload = await deps.fetchJson(buildAnnotationUrl({ gene, variant, drug }));
  if (payload === null) return [];

  return extractDataArray(payload)
    .slice(0, MAX_ANNOTATIONS)
    .map(normalizeClinicalAnnotation);
}

// --- Deterministic verdict -------------------------------------------------------

// Rank of each evidence level: index in the documented strongest→weakest ordering.
// A lower rank is STRONGER. Unknown/null levels get a rank worse than any real level
// so they never win the "strongest" selection over a genuinely-leveled annotation.
const LEVEL_RANK: Record<PgxEvidenceLevel, number> = PGX_EVIDENCE_LEVELS.reduce(
  (acc, level, i) => {
    acc[level] = i;
    return acc;
  },
  {} as Record<PgxEvidenceLevel, number>
);
const UNKNOWN_LEVEL_RANK = PGX_EVIDENCE_LEVELS.length;

function levelRank(level: PgxEvidenceLevel | null): number {
  return level === null ? UNKNOWN_LEVEL_RANK : LEVEL_RANK[level];
}

/**
 * Select the STRONGEST annotation: the one with the best (lowest-rank) evidence
 * level. Ties are broken by preferring an annotation that carries a guideline, then
 * by input order (stable) — this is deterministic: same inputs, same pick. Returns
 * null for an empty list.
 */
export function selectStrongestAnnotation(
  annotations: ClinicalAnnotation[]
): ClinicalAnnotation | null {
  let best: ClinicalAnnotation | null = null;
  let bestRank = Number.POSITIVE_INFINITY;
  for (const ann of annotations) {
    const rank = levelRank(ann.evidenceLevel);
    if (rank < bestRank) {
      best = ann;
      bestRank = rank;
      continue;
    }
    // Tie-break at equal rank: prefer one with an attached guideline.
    if (rank === bestRank && best && !best.guideline && ann.guideline) {
      best = ann;
    }
  }
  return best;
}

// Map an evidence level onto the deterministic confidence verdict. This mapping IS
// the documented PharmGKB strength banding: 1A/1B = high, 2A/2B = moderate, 3/4 =
// preliminary. A null/unknown level cannot claim confidence → preliminary.
function verdictForLevel(level: PgxEvidenceLevel | null): PgxVerdict {
  switch (level) {
    case "1A":
    case "1B":
      return "high_confidence";
    case "2A":
    case "2B":
      return "moderate";
    case "3":
    case "4":
      return "preliminary";
    default:
      return "preliminary";
  }
}

function rationaleFor(
  verdict: PgxVerdict,
  strongest: ClinicalAnnotation | null
): string {
  if (verdict === "not_found" || !strongest) {
    return "PharmGKB returned no clinical annotation for this gene/variant and drug.";
  }
  const level = strongest.evidenceLevel ?? "unspecified";
  const guide = strongest.guideline
    ? ` with an associated guideline (${strongest.guideline})`
    : "";
  switch (verdict) {
    case "high_confidence":
      return `PharmGKB carries a level ${level} clinical annotation (high-confidence evidence)${guide}.`;
    case "moderate":
      return `PharmGKB carries a level ${level} clinical annotation (moderate evidence)${guide}.`;
    case "preliminary":
      return `PharmGKB's strongest matching annotation is level ${level} (preliminary evidence)${guide}.`;
    default:
      return "PharmGKB returned no clinical annotation for this gene/variant and drug.";
  }
}

/**
 * Classify a set of clinical annotations DETERMINISTICALLY into a PGx verdict.
 *
 * Verdict is a pure function of the strongest annotation's evidence level, using the
 * documented PharmGKB level ordering (1A > 1B > 2A > 2B > 3 > 4):
 *   1A / 1B → high_confidence
 *   2A / 2B → moderate
 *   3  / 4  → preliminary
 *   (no annotations) → not_found  (honest empty)
 *
 * `claimedEffect` is echoed for audit but NEVER changes the verdict — the verdict is
 * decided purely by PharmGKB evidence, so a caller's stated belief can't inflate it.
 * No LLM, no randomness — same annotations, same verdict.
 */
export function classifyPgxAnnotations(input: {
  gene: string | null;
  variant: string | null;
  drug: string;
  claimedEffect: string | null;
  annotations: ClinicalAnnotation[];
}): PgxVerificationResult {
  const { gene, variant, drug, claimedEffect, annotations } = input;

  const strongest = selectStrongestAnnotation(annotations);
  const verdict: PgxVerdict =
    annotations.length === 0 || strongest === null
      ? "not_found"
      : verdictForLevel(strongest.evidenceLevel);

  return {
    verdict,
    gene,
    variant,
    drug,
    claimedEffect,
    strongestEvidenceLevel: strongest?.evidenceLevel ?? null,
    strongest,
    annotations,
    rationale: rationaleFor(verdict, strongest),
    attribution: PHARMGKB_ATTRIBUTION,
  };
}

/**
 * End-to-end PGx claim verification: look up PharmGKB clinical annotations for the
 * gene/variant × drug, then classify them deterministically. A failing upstream
 * degrades to an empty annotation list (honest not_found) rather than an error or a
 * fabricated level — mirroring the resilience of the other bio engines.
 */
export async function verifyPgxClaim(
  request: {
    gene?: string;
    variant?: string;
    drug: string;
    claimedEffect?: string;
  },
  deps: PharmGkbDeps = defaultDeps
): Promise<PgxVerificationResult> {
  const gene = request.gene?.trim() || undefined;
  const variant = request.variant?.trim() || undefined;
  const drug = request.drug.trim();
  const claimedEffect = request.claimedEffect?.trim() || null;

  const annotations = await lookupClinicalAnnotation(
    { gene, variant, drug },
    deps
  ).catch(() => [] as ClinicalAnnotation[]);

  return classifyPgxAnnotations({
    gene: gene ?? null,
    variant: variant ?? null,
    drug,
    claimedEffect,
    annotations,
  });
}
