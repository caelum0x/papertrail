import { describe, it, expect } from "vitest";
import {
  reconstructAbstract,
  searchOpenAlex,
  type FetchLike,
  type OpenAlexDeps,
} from "../lib/sources/openalex";

// Offline tests over a MOCKED OpenAlex Works response — no network. Locks the two
// load-bearing behaviors ported from pyalex: reconstructing the abstract from
// `abstract_inverted_index` (invert_abstract) and the normalized field mapping.

// A fetcher that returns a fixed OpenAlex-shaped payload and captures the URL it
// was called with, so we can assert query construction (search + polite pool).
function mockFetch(payload: unknown): { fetch: FetchLike; calls: string[]; headers: Array<Record<string, string> | undefined> } {
  const calls: string[] = [];
  const headers: Array<Record<string, string> | undefined> = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push(url);
    headers.push(init?.headers);
    return { ok: true, status: 200, json: async () => payload };
  };
  return { fetch, calls, headers };
}

// --- reconstructAbstract: the inverted-index port ------------------------------

describe("reconstructAbstract — abstract_inverted_index → text", () => {
  it("orders words by position, not by insertion order", () => {
    // "the quick brown fox" scrambled in the index; positions define the order.
    const idx = { fox: [3], the: [0], brown: [2], quick: [1] };
    expect(reconstructAbstract(idx)).toBe("the quick brown fox");
  });

  it("handles words that repeat at multiple positions", () => {
    // "to be or not to be" — "to" at 0 and 4, "be" at 1 and 5.
    const idx = { to: [0, 4], be: [1, 5], or: [2], not: [3] };
    expect(reconstructAbstract(idx)).toBe("to be or not to be");
  });

  it("returns null for a missing/absent index (works with no abstract)", () => {
    expect(reconstructAbstract(null)).toBeNull();
    expect(reconstructAbstract(undefined)).toBeNull();
    expect(reconstructAbstract({})).toBeNull();
  });
});

// --- searchOpenAlex: normalized mapping over a mocked response -----------------

describe("searchOpenAlex — normalized mapping (mocked OpenAlex)", () => {
  const sampleResults = {
    results: [
      {
        id: "https://openalex.org/W2741809807",
        display_name: "Drug X reduced cardiovascular events by 30%",
        abstract_inverted_index: {
          Drug: [0],
          X: [1],
          reduced: [2],
          events: [3],
        },
        doi: "https://doi.org/10.1234/abc.def",
        publication_year: 2021,
        cited_by_count: 142,
        is_retracted: false,
      },
      {
        id: "https://openalex.org/W999",
        display_name: "A work with no abstract",
        abstract_inverted_index: null,
        doi: null,
        publication_year: 2019,
        cited_by_count: 0,
        is_retracted: true,
      },
    ],
  };

  it("maps id/title/abstract/doi/year/citedByCount/isRetracted from raw payload", async () => {
    const { fetch } = mockFetch(sampleResults);
    const works = await searchOpenAlex({ query: "drug X cardiovascular", limit: 5 }, { fetch });

    expect(works).toHaveLength(2);

    // First work: full mapping, abstract reconstructed from the inverted index.
    expect(works[0]).toEqual({
      openalexId: "W2741809807", // short id, not the full URL
      title: "Drug X reduced cardiovascular events by 30%",
      abstract: "Drug X reduced events",
      doi: "10.1234/abc.def", // bare DOI, doi.org prefix stripped
      year: 2021,
      citedByCount: 142,
      isRetracted: false,
    });

    // Second work: no abstract → null; retracted flag preserved.
    expect(works[1].openalexId).toBe("W999");
    expect(works[1].abstract).toBeNull();
    expect(works[1].doi).toBeNull();
    expect(works[1].isRetracted).toBe(true);
  });

  it("hits the Works search endpoint with per-page and the polite-pool mailto", async () => {
    const { fetch, calls, headers } = mockFetch(sampleResults);
    const deps: OpenAlexDeps = { fetch, email: "hi@papertrail.dev" };
    await searchOpenAlex({ query: "aspirin", limit: 3 }, deps);

    expect(calls).toHaveLength(1);
    const url = new URL(calls[0]);
    expect(url.pathname).toBe("/works");
    expect(url.searchParams.get("search")).toBe("aspirin");
    expect(url.searchParams.get("per-page")).toBe("3");
    expect(url.searchParams.get("mailto")).toBe("hi@papertrail.dev");
    // Polite pool also sets the From header (pyalex OpenAlexAuth parity).
    expect(headers[0]?.From).toBe("hi@papertrail.dev");
  });

  it("clamps limit to OpenAlex's 1..200 per-page range", async () => {
    const { fetch, calls } = mockFetch(sampleResults);
    await searchOpenAlex({ query: "x", limit: 9999 }, { fetch });
    expect(new URL(calls[0]).searchParams.get("per-page")).toBe("200");
  });

  it("blank query short-circuits without a network call (honest empty)", async () => {
    const { fetch, calls } = mockFetch(sampleResults);
    const works = await searchOpenAlex({ query: "   " }, { fetch });
    expect(works).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("non-2xx upstream → empty array, never throws", async () => {
    const failing: FetchLike = async () => ({ ok: false, status: 503, json: async () => ({}) });
    const works = await searchOpenAlex({ query: "anything" }, { fetch: failing });
    expect(works).toEqual([]);
  });
});
