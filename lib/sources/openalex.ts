// Native OpenAlex REST client — a TypeScript port of pyalex (MIT), NOT a subprocess
// or HTTP bridge to a service. It broadens PaperTrail's sources beyond PubMed /
// ClinicalTrials.gov by querying the OpenAlex Works corpus directly with fetch.
//
// Ported from pyalex/api.py:
//   - Works().search(q).get()  -> `${WORKS_URL}?search=<q>&per-page=<n>` (BaseOpenAlex.url + _url_query)
//   - invert_abstract()        -> reconstructAbstract() below (abstract_inverted_index)
//   - OpenAlexAuth polite pool  -> the `mailto` query param + `From`/`User-Agent` headers
//
// Docs: https://docs.openalex.org/how-to-use-the-api/api-overview
// Setting a contact email joins OpenAlex's "polite pool" for faster, more reliable
// service. Configure via OPENALEX_EMAIL. Never log the caller's query text.

const WORKS_URL = "https://api.openalex.org/works";
const USER_AGENT = "papertrail/1.0 (native openalex client)";
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 200; // OpenAlex per-page cap (pyalex Paginator enforces the same 1..200 range).

// A normalized OpenAlex work — the subset PaperTrail ingests. Deterministic,
// LLM-free mapping straight from the API payload.
export interface OpenAlexWork {
  openalexId: string | null;
  title: string | null;
  abstract: string | null;
  doi: string | null;
  year: number | null;
  citedByCount: number | null;
  isRetracted: boolean;
}

export interface SearchOpenAlexInput {
  query: string;
  limit?: number;
}

// A minimal structural subtype of the DOM fetch, so tests can inject an offline
// stub without pulling in the full lib.dom typings.
export type FetchLike = (
  url: string,
  init?: { headers?: Record<string, string> }
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

export interface OpenAlexDeps {
  fetch?: FetchLike;
  email?: string;
}

/**
 * Reconstruct a plain-text abstract from OpenAlex's `abstract_inverted_index`.
 *
 * OpenAlex stores abstracts as { word: [positions...] } to sidestep copyright on
 * the contiguous text. This is a direct port of pyalex's `invert_abstract`: flatten
 * to (word, position) pairs, sort by position, then join the words with spaces.
 * Returns null when the index is absent (many works legitimately have no abstract).
 */
export function reconstructAbstract(
  invertedIndex: Record<string, number[]> | null | undefined
): string | null {
  if (invertedIndex == null || typeof invertedIndex !== "object") return null;

  const pairs: Array<[string, number]> = [];
  for (const [word, positions] of Object.entries(invertedIndex)) {
    if (!Array.isArray(positions)) continue;
    for (const pos of positions) {
      if (typeof pos === "number" && Number.isFinite(pos)) pairs.push([word, pos]);
    }
  }
  if (pairs.length === 0) return null;

  pairs.sort((a, b) => a[1] - b[1]);
  return pairs.map(([word]) => word).join(" ");
}

// OpenAlex ids are full URLs (e.g. "https://openalex.org/W123"); keep the short id.
function shortId(id: unknown): string | null {
  if (typeof id !== "string" || id.length === 0) return null;
  const slash = id.lastIndexOf("/");
  return slash >= 0 ? id.slice(slash + 1) : id;
}

// DOIs come back as a URL (e.g. "https://doi.org/10.1/x"); normalize to the bare DOI.
function normalizeDoi(doi: unknown): string | null {
  if (typeof doi !== "string" || doi.length === 0) return null;
  return doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "");
}

function toInt(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return Math.trunc(v);
}

// Deterministic mapping from a raw OpenAlex Work object to our normalized shape.
// Every field is defensively narrowed — external data is never trusted.
function normalizeWork(raw: unknown): OpenAlexWork {
  const w = (raw ?? {}) as Record<string, unknown>;
  return {
    openalexId: shortId(w.id),
    title: typeof w.display_name === "string" ? w.display_name : null,
    abstract: reconstructAbstract(
      w.abstract_inverted_index as Record<string, number[]> | null | undefined
    ),
    doi: normalizeDoi(w.doi),
    year: toInt(w.publication_year),
    citedByCount: toInt(w.cited_by_count),
    isRetracted: w.is_retracted === true,
  };
}

function clampLimit(limit: number | undefined): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) return DEFAULT_LIMIT;
  const n = Math.trunc(limit);
  if (n < 1) return 1;
  if (n > MAX_LIMIT) return MAX_LIMIT;
  return n;
}

/**
 * Search the OpenAlex Works corpus and return normalized records.
 *
 * Mirrors pyalex `Works().search(query).get(per_page=limit)`: hits the Works
 * endpoint with the `search` param and `per-page`, then maps each result. An
 * injectable `fetch` keeps tests fully offline. On a non-2xx response this returns
 * an empty array (honest empty) rather than throwing — the caller can fall back to
 * the existing retrieval path. Never logs or places the query anywhere but the URL.
 */
export async function searchOpenAlex(
  input: SearchOpenAlexInput,
  deps: OpenAlexDeps = {}
): Promise<OpenAlexWork[]> {
  const query = typeof input?.query === "string" ? input.query.trim() : "";
  if (query === "") return [];

  const doFetch: FetchLike = deps.fetch ?? (globalThis.fetch as unknown as FetchLike);
  const email = deps.email ?? process.env.OPENALEX_EMAIL;

  const params = new URLSearchParams({
    search: query,
    "per-page": String(clampLimit(input.limit)),
    // Only reconstructing the abstract + these normalized fields, so trim the payload.
    select: "id,display_name,abstract_inverted_index,doi,publication_year,cited_by_count,is_retracted",
  });
  // Polite pool: OpenAlex prefers the contact in the `mailto` query param.
  if (email) params.set("mailto", email);

  const headers: Record<string, string> = { "User-Agent": USER_AGENT };
  if (email) headers.From = email; // pyalex OpenAlexAuth also sets the From header.

  const res = await doFetch(`${WORKS_URL}?${params.toString()}`, { headers });
  if (!res.ok) return [];

  const data = (await res.json()) as { results?: unknown };
  const results = Array.isArray(data?.results) ? data.results : [];
  return results.map(normalizeWork);
}
