// NCBI PubTator Central (PubTator3) client — PaperTrail's biomedical ENTITY
// NORMALIZATION / grounding layer. It maps free text and PMIDs to normalized
// bio-entities (genes, diseases, chemicals, variants, species) with the exact
// database-qualified identifiers PubTator resolved (e.g. "NCBI Gene:673",
// "MESH:D009369", "dbSNP:rs334", "9606"). We NEVER fabricate an entity: only what
// PubTator actually returned is surfaced. Empty / failed responses degrade to an
// honest empty result, never a guessed number or entity.
//
// Two entry points:
//   annotatePmids(pmids) — batch-export the pre-computed annotations PubTator holds
//                          for already-indexed PubMed articles (BioC JSON).
//   annotateText(text)   — submit arbitrary text for on-the-fly annotation, then
//                          poll for the retrieved result (BioC JSON).
//
// All network I/O goes through an INJECTABLE fetcher (PubtatorDeps.fetchImpl) so the
// unit tests run fully offline against mocked responses — mirroring the
// injectable-deps pattern in lib/ingest/searchAndCache.ts. Nothing here logs the
// caller's free text.
//
// API docs: https://www.ncbi.nlm.nih.gov/research/pubtator3-api/

import {
  type BioEntity,
  type EntityType,
  type NormalizedEntityGroup,
  type PmidAnnotation,
} from "./entities.schemas";

const PUBTATOR_BASE = "https://www.ncbi.nlm.nih.gov/research/pubtator3-api";

// Batch export of pre-computed annotations for indexed PMIDs (BioC JSON).
const EXPORT_URL = `${PUBTATOR_BASE}/publications/export/biocjson`;
// On-the-fly annotation: submit free text (returns a session id), then retrieve.
const SUBMIT_URL = `${PUBTATOR_BASE}/entity/submit/`;
const RETRIEVE_URL = `${PUBTATOR_BASE}/entity/retrieve`;

// Bounded polling for the on-the-fly retrieve step so a stuck job never hangs a
// request. Deterministic, small budget — PubTator annotation of a short passage is
// fast; if it isn't ready in this window we return an honest empty result.
const RETRIEVE_MAX_ATTEMPTS = 6;
const RETRIEVE_DELAY_MS = 1_000;
const REQUEST_TIMEOUT_MS = 20_000;

// The minimal fetch surface we depend on — a subset of the DOM `fetch` so the tests
// can supply a tiny stub without constructing full Response objects.
export interface FetchLike {
  (
    input: string,
    init?: {
      method?: string;
      headers?: Record<string, string>;
      body?: string;
      signal?: AbortSignal;
    }
  ): Promise<FetchLikeResponse>;
}

export interface FetchLikeResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

export interface PubtatorDeps {
  fetchImpl: FetchLike;
  // Injectable sleep so the retrieve-poll loop is instant under test.
  sleep: (ms: number) => Promise<void>;
}

const defaultDeps: PubtatorDeps = {
  fetchImpl: ((input, init) =>
    fetch(input, init as RequestInit) as unknown as Promise<FetchLikeResponse>) as FetchLike,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

// ---------------------------------------------------------------------------
// BioC JSON parsing — pure, defensive. PubTator returns a document collection whose
// passages carry annotations. We only trust fields we can validate; anything else is
// skipped. No throw on malformed input — a bad document yields no entities.
// ---------------------------------------------------------------------------

// Maps PubTator's BioC `infons.type` values to our normalized EntityType union.
// PubTator uses several spellings/casings across endpoints; unknown types are dropped.
const TYPE_MAP: Readonly<Record<string, EntityType>> = {
  gene: "gene",
  genes: "gene",
  disease: "disease",
  diseases: "disease",
  chemical: "chemical",
  chemicals: "chemical",
  drug: "chemical",
  variant: "variant",
  mutation: "variant",
  dnamutation: "variant",
  proteinmutation: "variant",
  snp: "variant",
  species: "species",
  organism: "species",
  cellline: "species", // PubTator groups cell lines with species-scope in some exports
};

function mapType(raw: unknown): EntityType | null {
  if (typeof raw !== "string") return null;
  return TYPE_MAP[raw.trim().toLowerCase()] ?? null;
}

// PubTator carries the ontology id under different infon keys depending on endpoint
// and entity type (`identifier`, `normalized_id`, `NCBI Gene`, `MESH`, ...). We take
// the first non-empty, non-placeholder value. Returns null when PubTator recognized
// the mention but did not link it to an id — an honest "typed but unlinked" entity.
const ID_INFON_KEYS = [
  "identifier",
  "normalized_id",
  "normalizedId",
  "NCBI Gene",
  "MESH",
  "Identifier",
];
const PLACEHOLDER_IDS = new Set(["", "-", "none", "null", "na", "n/a"]);

function extractNormalizedId(infons: Record<string, unknown>): string | null {
  for (const key of ID_INFON_KEYS) {
    const value = infons[key];
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed.length > 0 && !PLACEHOLDER_IDS.has(trimmed.toLowerCase())) {
        return trimmed;
      }
    }
  }
  return null;
}

interface BiocLocation {
  offset?: unknown;
  length?: unknown;
}

interface BiocAnnotation {
  text?: unknown;
  infons?: Record<string, unknown>;
  locations?: BiocLocation[];
}

interface BiocPassage {
  annotations?: BiocAnnotation[];
}

interface BiocDocument {
  id?: unknown;
  pmid?: unknown;
  passages?: BiocPassage[];
}

/** Parse one BioC annotation into a BioEntity, or null if it isn't a resolvable entity. */
function parseAnnotation(ann: BiocAnnotation): BioEntity | null {
  const text = typeof ann.text === "string" ? ann.text.trim() : "";
  if (text.length === 0) return null;

  const infons = ann.infons ?? {};
  const type = mapType(infons.type);
  if (!type) return null; // unknown/unsupported type — never coerced

  const normalizedId = extractNormalizedId(infons);

  const offsets = Array.isArray(ann.locations)
    ? ann.locations
        .map((loc) => ({
          start: Number(loc.offset),
          length: Number(loc.length),
        }))
        .filter(
          (o) =>
            Number.isInteger(o.start) &&
            o.start >= 0 &&
            Number.isInteger(o.length) &&
            o.length > 0
        )
    : [];

  return { text, type, normalizedId, offsets };
}

/** Extract every BioEntity from one BioC document (across all its passages). */
function parseDocument(doc: BiocDocument): { pmid: string | null; entities: BioEntity[] } {
  const pmidRaw = doc.pmid ?? doc.id;
  const pmid =
    typeof pmidRaw === "string" && pmidRaw.trim().length > 0
      ? pmidRaw.trim()
      : typeof pmidRaw === "number"
        ? String(pmidRaw)
        : null;

  const entities: BioEntity[] = [];
  const passages = Array.isArray(doc.passages) ? doc.passages : [];
  for (const passage of passages) {
    const annotations = Array.isArray(passage.annotations) ? passage.annotations : [];
    for (const ann of annotations) {
      const entity = parseAnnotation(ann);
      if (entity) entities.push(entity);
    }
  }
  return { pmid, entities };
}

/**
 * Parse a PubTator BioC-JSON body (string) into per-document annotations. Handles
 * both the multi-document export shape ({ PubTator3: [...] } or { documents: [...] })
 * and a single-document retrieve response. Never throws: malformed JSON or an
 * unexpected shape yields an empty list — an honest empty result.
 */
export function parseBiocJson(body: string): PmidAnnotation[] {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return [];
  }

  const documents = collectDocuments(json);
  return documents.map((doc) => parseDocument(doc));
}

// PubTator's response envelope varies by endpoint. Normalize to a flat document list.
function collectDocuments(json: unknown): BiocDocument[] {
  if (Array.isArray(json)) return json as BiocDocument[];
  if (!json || typeof json !== "object") return [];

  const obj = json as Record<string, unknown>;

  // Export endpoint sometimes wraps documents under a version key or `documents`.
  for (const key of ["PubTator3", "documents", "collection"]) {
    const value = obj[key];
    if (Array.isArray(value)) return value as BiocDocument[];
    if (value && typeof value === "object" && Array.isArray((value as Record<string, unknown>).documents)) {
      return (value as { documents: BiocDocument[] }).documents;
    }
  }

  // A single BioC document (retrieve endpoint) — has passages directly.
  if (Array.isArray(obj.passages)) return [obj as BiocDocument];

  return [];
}

// ---------------------------------------------------------------------------
// Pure normalization helper: de-dupe + group raw annotations by (type, normalizedId).
// ---------------------------------------------------------------------------

function groupKey(type: EntityType, normalizedId: string | null): string {
  // Unlinked mentions (null id) are grouped per-type-per-surface-text so distinct
  // unresolved mentions don't collapse into one meaningless bucket.
  return normalizedId === null ? `${type}::__unlinked__` : `${type}::${normalizedId}`;
}

/**
 * De-dupe and group a flat list of entities by their normalized identity. Entities
 * sharing the same (type, normalizedId) collapse into one group carrying every
 * distinct surface form and every offset. Unlinked (null-id) entities are grouped by
 * (type, surface text) so they stay individually meaningful. Pure and order-stable.
 */
export function normalizeEntities(entities: readonly BioEntity[]): NormalizedEntityGroup[] {
  const groups = new Map<string, NormalizedEntityGroup>();
  const order: string[] = [];

  for (const entity of entities) {
    // For unlinked entities, incorporate the surface text into the key so two
    // different unresolved mentions don't merge.
    const key =
      entity.normalizedId === null
        ? `${groupKey(entity.type, null)}::${entity.text.toLowerCase()}`
        : groupKey(entity.type, entity.normalizedId);

    const existing = groups.get(key);
    if (!existing) {
      order.push(key);
      groups.set(key, {
        type: entity.type,
        normalizedId: entity.normalizedId,
        mentions: [entity.text],
        offsets: [...entity.offsets],
        count: 1,
      });
      continue;
    }

    const mentions = existing.mentions.includes(entity.text)
      ? existing.mentions
      : [...existing.mentions, entity.text];

    const offsets = [...existing.offsets];
    for (const off of entity.offsets) {
      if (!offsets.some((o) => o.start === off.start && o.length === off.length)) {
        offsets.push(off);
      }
    }

    groups.set(key, {
      ...existing,
      mentions,
      offsets,
      count: existing.count + 1,
    });
  }

  return order.map((key) => groups.get(key)!);
}

// ---------------------------------------------------------------------------
// Network entry points.
// ---------------------------------------------------------------------------

/** Abort-bounded fetch that resolves to null on any network/timeout failure. */
async function safeFetch(
  deps: PubtatorDeps,
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string }
): Promise<FetchLikeResponse | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await deps.fetchImpl(url, { ...init, signal: controller.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Annotate a list of already-indexed PubMed articles by PMID. Returns one entry per
 * PMID PubTator resolved, each with its normalized entities. Requests the BioC-JSON
 * export in one batched call. On any failure (network, non-200, malformed body) it
 * returns an honest empty list — never a fabricated annotation.
 *
 * The caller is expected to pass validated numeric PMID strings; empties are dropped.
 */
export async function annotatePmids(
  pmids: readonly string[],
  deps: PubtatorDeps = defaultDeps
): Promise<PmidAnnotation[]> {
  const clean = Array.from(
    new Set(pmids.map((p) => (typeof p === "string" ? p.trim() : "")).filter((p) => /^\d{1,9}$/.test(p)))
  );
  if (clean.length === 0) return [];

  const url = `${EXPORT_URL}?pmids=${encodeURIComponent(clean.join(","))}`;
  const res = await safeFetch(deps, url, { method: "GET" });
  if (!res || !res.ok) return [];

  let body: string;
  try {
    body = await res.text();
  } catch {
    return [];
  }

  const parsed = parseBiocJson(body);
  // Each parsed doc already carries entities; normalize per-document offsets/dedupe is
  // left to the caller/route (which may want either raw or grouped). Here we return the
  // raw per-PMID entity lists, de-duplicated within each document.
  return parsed.map((doc) => ({
    pmid: doc.pmid,
    entities: dedupeWithinDocument(doc.entities),
  }));
}

/**
 * Annotate arbitrary free text on-the-fly. Submits the text to PubTator (which returns
 * a session id), then polls the retrieve endpoint until the annotated BioC-JSON is
 * ready or the bounded attempt budget is exhausted. Returns a single-element list with
 * pmid=null on success, or an honest empty list on any failure/timeout.
 *
 * The text is sent in the POST body only — never on a URL or in a log line.
 */
export async function annotateText(
  text: string,
  deps: PubtatorDeps = defaultDeps
): Promise<PmidAnnotation[]> {
  const trimmed = typeof text === "string" ? text.trim() : "";
  if (trimmed.length === 0) return [];

  // 1. Submit — PubTator responds with a plain-text session id.
  const submitRes = await safeFetch(deps, SUBMIT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: trimmed }),
  });
  if (!submitRes || !submitRes.ok) return [];

  let sessionId: string;
  try {
    sessionId = (await submitRes.text()).trim();
  } catch {
    return [];
  }
  if (sessionId.length === 0) return [];

  // 2. Retrieve — poll until the annotation is ready (200 + BioC body) or budget runs
  //    out. A 404/202 means "not ready yet"; we back off and retry a bounded number of
  //    times. Any hard failure yields an honest empty result.
  const retrieveUrl = `${RETRIEVE_URL}/${encodeURIComponent(sessionId)}`;
  for (let attempt = 0; attempt < RETRIEVE_MAX_ATTEMPTS; attempt++) {
    const res = await safeFetch(deps, retrieveUrl, { method: "GET" });
    if (res && res.ok) {
      let body: string;
      try {
        body = await res.text();
      } catch {
        return [];
      }
      const parsed = parseBiocJson(body);
      if (parsed.length > 0) {
        return parsed.map((doc) => ({
          pmid: null, // on-the-fly text has no PMID
          entities: dedupeWithinDocument(doc.entities),
        }));
      }
      // 200 but no parseable documents yet — treat as not-ready and keep polling.
    }
    if (attempt < RETRIEVE_MAX_ATTEMPTS - 1) {
      await deps.sleep(RETRIEVE_DELAY_MS);
    }
  }

  return [];
}

// De-dupe identical (text, type, normalizedId, offset-set) entities within a single
// document while preserving the raw per-mention list order. Distinct offsets of the
// same entity are merged onto one BioEntity.
function dedupeWithinDocument(entities: readonly BioEntity[]): BioEntity[] {
  const byKey = new Map<string, BioEntity>();
  const order: string[] = [];

  for (const entity of entities) {
    const key = `${entity.type}::${entity.normalizedId ?? "__unlinked__"}::${entity.text.toLowerCase()}`;
    const existing = byKey.get(key);
    if (!existing) {
      order.push(key);
      byKey.set(key, { ...entity, offsets: [...entity.offsets] });
      continue;
    }
    const offsets = [...existing.offsets];
    for (const off of entity.offsets) {
      if (!offsets.some((o) => o.start === off.start && o.length === off.length)) {
        offsets.push(off);
      }
    }
    byKey.set(key, { ...existing, offsets });
  }

  return order.map((key) => byKey.get(key)!);
}
