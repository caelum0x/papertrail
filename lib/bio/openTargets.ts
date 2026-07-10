import { callClaudeForJson } from "../claude";
import {
  DatatypeScoresSchema,
  EvidenceSummarySchema,
  type DatatypeScores,
  type EvidenceSummary,
  type KnownDrug,
  type ResolvedDisease,
  type ResolvedTarget,
  type TargetDiseaseEvidence,
  type Tractability,
} from "./targets.schemas";

// Target–disease EVIDENCE aggregation via the Open Targets Platform GraphQL API.
//
// MOAT: the association scores returned here are the DETERMINISTIC values the
// Open Targets platform computes and serves — genetic association, known drug,
// literature, animal model, plus the overall harmonic-sum score. We return them
// VERBATIM. No LLM is anywhere in the numeric path. The only place Claude appears
// is the OPTIONAL `summarizeEvidence`, which writes plain-language prose ABOUT the
// already-returned numbers and is validated against a Zod schema (CLAUDE.md rule).
//
// All network access goes through a single injectable `graphql` fetcher (mirroring
// lib/ingest/searchAndCache.ts's injectable-deps pattern) so tests run fully
// offline against a mocked GraphQL response — no live network in the test suite.
//
// On API failure we return an HONEST empty result (no association, null scores) —
// never a fabricated number. A wrong "confident" answer is worse than an honest
// "couldn't find it."

const OPEN_TARGETS_GRAPHQL_URL =
  "https://api.platform.opentargets.org/api/v4/graphql";

// Bound requests so a hung upstream never wedges a serverless invocation.
const REQUEST_TIMEOUT_MS = 12_000;
// Cap the aggregated rows we surface so a huge association can't balloon the
// response (and the token budget of any downstream summary).
const MAX_KNOWN_DRUGS = 25;
const MAX_TRACTABILITY = 20;

// The single injectable network primitive: run a GraphQL query against Open
// Targets and return the parsed JSON `data` payload (or null on any failure).
// Tests pass a deterministic stub; the default hits the live endpoint.
export interface OpenTargetsDeps {
  graphql: (query: string, variables: Record<string, unknown>) => Promise<unknown>;
}

async function defaultGraphql(
  query: string,
  variables: Record<string, unknown>
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(OPEN_TARGETS_GRAPHQL_URL, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ query, variables }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: unknown; errors?: unknown };
    // A GraphQL response can be HTTP 200 with a top-level `errors` array; treat
    // that as a failed lookup rather than trusting a partial `data`.
    if (json && typeof json === "object" && "errors" in json && json.errors) {
      return null;
    }
    return (json as { data?: unknown }).data ?? null;
  } catch {
    // Network error / timeout / bad JSON — honest empty, never a fabrication.
    return null;
  }
}

const defaultDeps: OpenTargetsDeps = { graphql: defaultGraphql };

// ---------------------------------------------------------------------------
// Safe extractors: pull values out of the untyped GraphQL payload without ever
// throwing. A missing/malformed field degrades to null, never a fabricated value.
// ---------------------------------------------------------------------------

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

// Clamp a raw score into [0, 1] verbatim-but-safe. Out-of-range or non-numeric
// becomes null (honest "no score") rather than a clamped fabrication.
function score(v: unknown): number | null {
  const n = num(v);
  if (n === null) return null;
  if (n < 0 || n > 1) return null;
  return n;
}

// ---------------------------------------------------------------------------
// resolveTarget / resolveDisease — symbol/name -> Ensembl gene id / EFO id
// via the Open Targets search entity resolver.
// ---------------------------------------------------------------------------

const TARGET_SEARCH_QUERY = `
  query ResolveTarget($q: String!) {
    search(queryString: $q, entityNames: ["target"], page: { index: 0, size: 1 }) {
      hits {
        id
        entity
        object { ... on Target { id approvedSymbol approvedName } }
      }
    }
  }
`;

const DISEASE_SEARCH_QUERY = `
  query ResolveDisease($q: String!) {
    search(queryString: $q, entityNames: ["disease"], page: { index: 0, size: 1 }) {
      hits {
        id
        entity
        object { ... on Disease { id name } }
      }
    }
  }
`;

function firstHitObject(data: unknown): Record<string, unknown> | null {
  const search = asRecord(asRecord(data)?.search);
  const hits = asArray(search?.hits);
  if (hits.length === 0) return null;
  const hit = asRecord(hits[0]);
  // Prefer the typed `object`; fall back to the hit's own id if object is absent.
  return asRecord(hit?.object) ?? hit;
}

export async function resolveTarget(
  symbol: string,
  deps: OpenTargetsDeps = defaultDeps
): Promise<ResolvedTarget> {
  const querySymbol = symbol.trim();
  const empty: ResolvedTarget = {
    querySymbol,
    ensemblId: null,
    approvedSymbol: null,
    approvedName: null,
  };
  if (querySymbol.length === 0) return empty;

  const data = await deps.graphql(TARGET_SEARCH_QUERY, { q: querySymbol });
  const obj = firstHitObject(data);
  if (!obj) return empty;

  return {
    querySymbol,
    ensemblId: str(obj.id),
    approvedSymbol: str(obj.approvedSymbol),
    approvedName: str(obj.approvedName),
  };
}

export async function resolveDisease(
  name: string,
  deps: OpenTargetsDeps = defaultDeps
): Promise<ResolvedDisease> {
  const queryName = name.trim();
  const empty: ResolvedDisease = { queryName, efoId: null, name: null };
  if (queryName.length === 0) return empty;

  const data = await deps.graphql(DISEASE_SEARCH_QUERY, { q: queryName });
  const obj = firstHitObject(data);
  if (!obj) return empty;

  return {
    queryName,
    efoId: str(obj.id),
    name: str(obj.name),
  };
}

// ---------------------------------------------------------------------------
// targetDiseaseEvidence — the core deterministic lookup. Resolves both ids,
// then queries the association: overall + per-datatype scores, known drugs,
// and target tractability. Scores are returned VERBATIM from the API.
// ---------------------------------------------------------------------------

const ASSOCIATION_QUERY = `
  query TargetDiseaseAssociation($ensemblId: String!, $efoId: String!) {
    disease(efoId: $efoId) {
      id
      associatedTargets(
        Bs: [$ensemblId]
        page: { index: 0, size: 1 }
      ) {
        rows {
          score
          datatypeScores { id score }
        }
      }
    }
    target(ensemblId: $ensemblId) {
      id
      knownDrugs(size: ${MAX_KNOWN_DRUGS}) {
        rows {
          drugId
          prefName
          mechanismOfAction
          phase
          status
        }
      }
      tractability {
        label
        modality
        value
      }
    }
  }
`;

// Map Open Targets' datatype ids onto the four buckets our schema surfaces.
// Anything outside these four is intentionally ignored — we only claim the
// datatypes we validate. A datatype absent from the API rows stays null.
const DATATYPE_ID_MAP: Record<string, keyof DatatypeScores> = {
  genetic_association: "genetic_association",
  known_drug: "known_drug",
  literature: "literature",
  animal_model: "animal_model",
};

function extractDatatypeScores(rows: unknown): DatatypeScores {
  const out: DatatypeScores = {
    genetic_association: null,
    known_drug: null,
    literature: null,
    animal_model: null,
  };
  for (const entry of asArray(rows)) {
    const rec = asRecord(entry);
    const id = str(rec?.id);
    if (!id) continue;
    const key = DATATYPE_ID_MAP[id];
    if (!key) continue;
    out[key] = score(rec?.score);
  }
  // Validate the shape before returning (defensive; scores already bounded).
  return DatatypeScoresSchema.parse(out);
}

function extractKnownDrugs(rows: unknown): KnownDrug[] {
  const seen = new Set<string>();
  const out: KnownDrug[] = [];
  for (const entry of asArray(rows)) {
    const rec = asRecord(entry);
    if (!rec) continue;
    const drug: KnownDrug = {
      drugId: str(rec.drugId),
      drugName: str(rec.prefName),
      mechanismOfAction: str(rec.mechanismOfAction),
      phase: num(rec.phase),
      status: str(rec.status),
    };
    // Dedupe on (drugId, mechanism) so the same drug listed per-indication once.
    const key = `${drug.drugId ?? ""}|${drug.mechanismOfAction ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(drug);
    if (out.length >= MAX_KNOWN_DRUGS) break;
  }
  return out;
}

function extractTractability(rows: unknown): Tractability[] {
  const out: Tractability[] = [];
  for (const entry of asArray(rows)) {
    const rec = asRecord(entry);
    const label = str(rec?.label);
    const modality = str(rec?.modality);
    if (!label || !modality) continue;
    out.push({ label, modality, value: rec?.value === true });
    if (out.length >= MAX_TRACTABILITY) break;
  }
  return out;
}

export async function targetDiseaseEvidence(
  targetSymbol: string,
  diseaseName: string,
  deps: OpenTargetsDeps = defaultDeps
): Promise<TargetDiseaseEvidence> {
  // 1. Resolve both entities (each degrades to an honest empty on failure).
  const [target, disease] = await Promise.all([
    resolveTarget(targetSymbol, deps),
    resolveDisease(diseaseName, deps),
  ]);

  const emptyDatatypes: DatatypeScores = {
    genetic_association: null,
    known_drug: null,
    literature: null,
    animal_model: null,
  };

  // If either id didn't resolve, there is no association to fetch — honest empty.
  if (!target.ensemblId || !disease.efoId) {
    return {
      found: false,
      target,
      disease,
      overallScore: null,
      datatypeScores: emptyDatatypes,
      knownDrugs: [],
      tractability: [],
    };
  }

  // 2. Query the association + aggregations.
  const data = await deps.graphql(ASSOCIATION_QUERY, {
    ensemblId: target.ensemblId,
    efoId: disease.efoId,
  });

  const root = asRecord(data);
  const diseaseNode = asRecord(root?.disease);
  const associated = asRecord(diseaseNode?.associatedTargets);
  const assocRows = asArray(associated?.rows);
  const firstRow = assocRows.length > 0 ? asRecord(assocRows[0]) : null;

  const overallScore = score(firstRow?.score);
  const datatypeScores = firstRow
    ? extractDatatypeScores(firstRow.datatypeScores)
    : emptyDatatypes;

  const targetNode = asRecord(root?.target);
  const knownDrugs = extractKnownDrugs(asRecord(targetNode?.knownDrugs)?.rows);
  const tractability = extractTractability(targetNode?.tractability);

  // `found` means: the pair actually has a scored association row. Known drugs /
  // tractability alone (target-level, disease-agnostic) don't imply an association.
  const found = firstRow !== null && overallScore !== null;

  return {
    found,
    target,
    disease,
    overallScore,
    datatypeScores,
    knownDrugs,
    tractability,
  };
}

// ---------------------------------------------------------------------------
// summarizeEvidence — OPTIONAL, additive Claude layer. It writes plain-language
// prose ABOUT the deterministic evidence. The SCORES stay from the API; the
// summary must only reference returned data, and is Zod-validated before use.
// ---------------------------------------------------------------------------

// Compact, deterministic serialization of the evidence for the prompt. We hand
// the model ONLY the returned numbers/labels so it cannot reference anything not
// in the data. Null scores are shown as "no evidence" (never fabricated to 0).
function evidenceForPrompt(evidence: TargetDiseaseEvidence): string {
  const s = (v: number | null) => (v === null ? "no evidence" : v.toFixed(3));
  const dt = evidence.datatypeScores;
  const drugs = evidence.knownDrugs
    .slice(0, 8)
    .map(
      (d) =>
        `- ${d.drugName ?? d.drugId ?? "unnamed"}` +
        `${d.phase !== null ? ` (phase ${d.phase})` : ""}` +
        `${d.mechanismOfAction ? `, ${d.mechanismOfAction}` : ""}`
    )
    .join("\n");
  const tract = evidence.tractability
    .filter((t) => t.value)
    .map((t) => `${t.modality}: ${t.label}`)
    .join("; ");

  return [
    `Target: ${evidence.target.approvedSymbol ?? evidence.target.querySymbol} (${evidence.target.ensemblId ?? "unresolved"})`,
    `Disease: ${evidence.disease.name ?? evidence.disease.queryName} (${evidence.disease.efoId ?? "unresolved"})`,
    `Association found: ${evidence.found}`,
    `Overall association score: ${s(evidence.overallScore)}`,
    `Genetic association score: ${s(dt.genetic_association)}`,
    `Known drug score: ${s(dt.known_drug)}`,
    `Literature score: ${s(dt.literature)}`,
    `Animal model score: ${s(dt.animal_model)}`,
    `Known drugs:${drugs ? `\n${drugs}` : " none returned"}`,
    `Tractability (satisfied): ${tract || "none returned"}`,
  ].join("\n");
}

const SUMMARY_SYSTEM = [
  "You summarize a target–disease association from the Open Targets Platform for a",
  "translational-research audience. You are given the association scores and aggregated",
  "evidence VERBATIM. Do NOT invent, recompute, or restate any number that is not in the",
  "provided data. Do NOT claim evidence for a datatype shown as 'no evidence'. Reference",
  "only the target, disease, scores, drugs, and tractability provided.",
  "",
  "Scores are in [0, 1] where higher means stronger aggregated evidence.",
  "",
  "Return ONLY a JSON object with exactly these keys:",
  '  "summary": a 2-4 sentence plain-language description of the association strength,',
  "             which datatypes drive it, and any known drugs / tractability worth noting.",
  '  "strongestDatatype": one of "genetic_association" | "known_drug" | "literature" |',
  '             "animal_model" | null — the datatype with the highest returned score, or',
  "             null if no datatype has a score.",
].join("\n");

/**
 * OPTIONAL plain-language summary of a deterministic target–disease association.
 * Calls Claude and validates the result against EvidenceSummarySchema. This is
 * strictly additive: the numeric scores in `evidence` are unchanged and remain
 * the source of truth. Callers that want no LLM simply never call this.
 *
 * Throws if Claude returns non-JSON or fails validation — the caller decides
 * whether to surface the numbers without a summary (they always can).
 */
export async function summarizeEvidence(
  evidence: TargetDiseaseEvidence,
  callJson: typeof callClaudeForJson = callClaudeForJson
): Promise<EvidenceSummary> {
  return callJson({
    system: SUMMARY_SYSTEM,
    user: evidenceForPrompt(evidence),
    schema: EvidenceSummarySchema,
    maxTokens: 512,
  });
}
