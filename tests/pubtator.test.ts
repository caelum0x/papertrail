import { describe, it, expect, vi } from "vitest";
import {
  annotatePmids,
  annotateText,
  normalizeEntities,
  parseBiocJson,
  type FetchLike,
  type FetchLikeResponse,
  type PubtatorDeps,
} from "../lib/bio/pubtator";
import type { BioEntity } from "../lib/bio/entities.schemas";

// All tests run over MOCKED PubTator responses — no live NCBI network. We assert:
//   1. BioC-JSON annotations are parsed + typed correctly (only supported types).
//   2. Repeated / multi-offset mentions are de-duped within a document.
//   3. normalizeEntities groups by (type, normalizedId), collapsing surface forms.
//   4. Empty / non-200 / malformed responses yield an honest empty result.
//   5. annotateText submits, polls retrieve, and returns pmid=null docs.
//   6. Nothing is fabricated: an unknown entity type is dropped, not coerced.

// A tiny Response stub matching FetchLikeResponse (ok/status/text()).
function res(status: number, body: string): FetchLikeResponse {
  return { ok: status >= 200 && status < 300, status, text: async () => body };
}

// Helper to build injectable deps with an instant sleep (poll loop is instant).
function makeDeps(fetchImpl: FetchLike): PubtatorDeps {
  return { fetchImpl, sleep: vi.fn(async () => {}) };
}

// A realistic PubTator3 BioC-JSON export body for one PMID with several entities,
// including a repeated mention (two offsets), an unlinked mention (no identifier),
// and an unsupported type that must be dropped.
function exportBody(): string {
  return JSON.stringify({
    PubTator3: [
      {
        id: "30763187",
        pmid: "30763187",
        passages: [
          {
            annotations: [
              {
                text: "EGFR",
                infons: { type: "Gene", identifier: "NCBI Gene:1956" },
                locations: [{ offset: 10, length: 4 }],
              },
              {
                // Same gene, a second mention at a different offset — must merge.
                text: "EGFR",
                infons: { type: "Gene", identifier: "NCBI Gene:1956" },
                locations: [{ offset: 55, length: 4 }],
              },
              {
                text: "lung cancer",
                infons: { type: "Disease", identifier: "MESH:D008175" },
                locations: [{ offset: 20, length: 11 }],
              },
              {
                text: "gefitinib",
                infons: { type: "Chemical", identifier: "MESH:C074316" },
                locations: [{ offset: 40, length: 9 }],
              },
              {
                // Recognized type but PubTator did not link an id — honest null.
                text: "some novel disease",
                infons: { type: "Disease", identifier: "-" },
                locations: [{ offset: 70, length: 18 }],
              },
              {
                // Unsupported type — must be DROPPED, never coerced/fabricated.
                text: "HeLa-unknown-xyz",
                infons: { type: "SomethingUnsupported", identifier: "X:1" },
                locations: [{ offset: 90, length: 5 }],
              },
            ],
          },
        ],
      },
    ],
  });
}

describe("parseBiocJson", () => {
  it("parses supported entity types and drops unsupported ones (no fabrication)", () => {
    const docs = parseBiocJson(exportBody());
    expect(docs).toHaveLength(1);
    const doc = docs[0];
    expect(doc.pmid).toBe("30763187");

    const types = doc.entities.map((e) => e.type);
    // EGFR x2, lung cancer, gefitinib, novel disease (unlinked) — 5 supported; the
    // unsupported "SomethingUnsupported" is dropped.
    expect(doc.entities).toHaveLength(5);
    expect(types).toContain("gene");
    expect(types).toContain("disease");
    expect(types).toContain("chemical");
    expect(types).not.toContain("SomethingUnsupported");

    const gene = doc.entities.find((e) => e.type === "gene");
    expect(gene?.normalizedId).toBe("NCBI Gene:1956");

    const unlinked = doc.entities.find((e) => e.text === "some novel disease");
    expect(unlinked?.normalizedId).toBeNull(); // placeholder "-" becomes honest null
  });

  it("returns an empty list for malformed JSON (never throws)", () => {
    expect(parseBiocJson("not json {{{")).toEqual([]);
    expect(parseBiocJson("")).toEqual([]);
    expect(parseBiocJson("null")).toEqual([]);
  });

  it("parses a single BioC document (retrieve-endpoint shape)", () => {
    const single = JSON.stringify({
      pmid: null,
      passages: [
        {
          annotations: [
            {
              text: "aspirin",
              infons: { type: "Chemical", identifier: "MESH:D001241" },
              locations: [{ offset: 0, length: 7 }],
            },
          ],
        },
      ],
    });
    const docs = parseBiocJson(single);
    expect(docs).toHaveLength(1);
    expect(docs[0].entities[0].text).toBe("aspirin");
    expect(docs[0].entities[0].type).toBe("chemical");
  });
});

describe("normalizeEntities", () => {
  it("groups by (type, normalizedId), collapsing surface forms + offsets", () => {
    const entities: BioEntity[] = [
      { text: "EGFR", type: "gene", normalizedId: "NCBI Gene:1956", offsets: [{ start: 10, length: 4 }] },
      { text: "epidermal growth factor receptor", type: "gene", normalizedId: "NCBI Gene:1956", offsets: [{ start: 55, length: 32 }] },
      { text: "lung cancer", type: "disease", normalizedId: "MESH:D008175", offsets: [{ start: 20, length: 11 }] },
    ];
    const groups = normalizeEntities(entities);

    expect(groups).toHaveLength(2); // the two EGFR entries collapse into one group
    const geneGroup = groups.find((g) => g.normalizedId === "NCBI Gene:1956");
    expect(geneGroup?.count).toBe(2);
    expect(geneGroup?.mentions).toEqual(["EGFR", "epidermal growth factor receptor"]);
    expect(geneGroup?.offsets).toEqual([
      { start: 10, length: 4 },
      { start: 55, length: 32 },
    ]);
  });

  it("keeps distinct unlinked mentions separate (no meaningless merge)", () => {
    const entities: BioEntity[] = [
      { text: "disease A", type: "disease", normalizedId: null, offsets: [{ start: 0, length: 9 }] },
      { text: "disease B", type: "disease", normalizedId: null, offsets: [{ start: 20, length: 9 }] },
    ];
    const groups = normalizeEntities(entities);
    expect(groups).toHaveLength(2);
    expect(groups.every((g) => g.normalizedId === null)).toBe(true);
  });

  it("returns an empty list for no entities", () => {
    expect(normalizeEntities([])).toEqual([]);
  });
});

describe("annotatePmids (mocked network)", () => {
  it("fetches the export URL and returns de-duped per-PMID entities", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toContain("/publications/export/biocjson");
      expect(url).toContain("30763187");
      return res(200, exportBody());
    }) as unknown as FetchLike;

    const out = await annotatePmids(["30763187"], makeDeps(fetchImpl));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(out).toHaveLength(1);
    expect(out[0].pmid).toBe("30763187");

    // Within-document dedupe: the two EGFR mentions collapse into one entity carrying
    // both offsets.
    const gene = out[0].entities.find((e) => e.type === "gene");
    expect(gene?.text).toBe("EGFR");
    expect(gene?.offsets).toEqual([
      { start: 10, length: 4 },
      { start: 55, length: 4 },
    ]);
    // 4 distinct entities after dedupe (EGFR, lung cancer, gefitinib, novel disease).
    expect(out[0].entities).toHaveLength(4);
  });

  it("returns an honest empty result on a non-200 response", async () => {
    const fetchImpl = vi.fn(async () => res(503, "upstream down")) as unknown as FetchLike;
    const out = await annotatePmids(["30763187"], makeDeps(fetchImpl));
    expect(out).toEqual([]);
  });

  it("returns an honest empty result on a network error (no throw)", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNRESET");
    }) as unknown as FetchLike;
    const out = await annotatePmids(["30763187"], makeDeps(fetchImpl));
    expect(out).toEqual([]);
  });

  it("skips invalid PMIDs and never calls the network when none are valid", async () => {
    const fetchImpl = vi.fn(async () => res(200, exportBody())) as unknown as FetchLike;
    const out = await annotatePmids(["not-a-pmid", ""], makeDeps(fetchImpl));
    expect(out).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("annotateText (mocked submit + retrieve)", () => {
  it("submits text, polls retrieve, and returns pmid=null entities", async () => {
    const sessionId = "abc123session";
    const retrieveBody = JSON.stringify({
      passages: [
        {
          annotations: [
            {
              text: "metformin",
              infons: { type: "Chemical", identifier: "MESH:D008687" },
              locations: [{ offset: 0, length: 9 }],
            },
            {
              text: "type 2 diabetes",
              infons: { type: "Disease", identifier: "MESH:D003924" },
              locations: [{ offset: 20, length: 15 }],
            },
          ],
        },
      ],
    });

    const fetchImpl = vi.fn(async (url: string, init) => {
      if (url.endsWith("/entity/submit/")) {
        expect(init?.method).toBe("POST");
        // The text must be in the POST body, never on the URL.
        expect(init?.body).toContain("metformin");
        expect(url).not.toContain("metformin");
        return res(200, sessionId);
      }
      if (url.includes("/entity/retrieve/")) {
        expect(url).toContain(sessionId);
        return res(200, retrieveBody);
      }
      throw new Error(`unexpected url ${url}`);
    }) as unknown as FetchLike;

    const out = await annotateText("metformin reduces type 2 diabetes events", makeDeps(fetchImpl));
    expect(out).toHaveLength(1);
    expect(out[0].pmid).toBeNull();
    expect(out[0].entities.map((e) => e.type).sort()).toEqual(["chemical", "disease"]);
  });

  it("returns an honest empty result if submit fails", async () => {
    const fetchImpl = vi.fn(async () => res(500, "submit failed")) as unknown as FetchLike;
    const out = await annotateText("some passage", makeDeps(fetchImpl));
    expect(out).toEqual([]);
  });

  it("returns an honest empty result if retrieve never becomes ready", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith("/entity/submit/")) return res(200, "sess-1");
      return res(404, "not ready"); // retrieve always 404
    }) as unknown as FetchLike;
    const out = await annotateText("some passage", makeDeps(fetchImpl));
    expect(out).toEqual([]);
  });

  it("returns empty for blank text without touching the network", async () => {
    const fetchImpl = vi.fn(async () => res(200, "x")) as unknown as FetchLike;
    const out = await annotateText("   ", makeDeps(fetchImpl));
    expect(out).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
