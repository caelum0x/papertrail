import { describe, it, expect } from "vitest";
import {
  parseBibTeX,
  parseRIS,
  serializeBibTeX,
  serializeRIS,
  serializeCSV,
} from "@/lib/references/formats";
import type { Reference } from "@/lib/references/types";

function asReference(partial: Partial<Reference>): Reference {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    orgId: "org",
    libraryId: "lib",
    type: "article",
    title: null,
    authors: [],
    year: null,
    journal: null,
    doi: null,
    pmid: null,
    nctId: null,
    url: null,
    raw: {},
    createdAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

describe("parseBibTeX", () => {
  it("parses a single article with common fields", () => {
    const text = `@article{smith2020,
      title = {A Study of Drug X},
      author = {Smith, Jane and Doe, John},
      year = {2020},
      journal = {NEJM},
      doi = {10.1000/xyz},
      url = {https://example.org}
    }`;
    const refs = parseBibTeX(text);
    expect(refs).toHaveLength(1);
    const r = refs[0];
    expect(r.title).toBe("A Study of Drug X");
    expect(r.authors).toEqual(["Smith, Jane", "Doe, John"]);
    expect(r.year).toBe(2020);
    expect(r.journal).toBe("NEJM");
    expect(r.doi).toBe("10.1000/xyz");
    expect(r.url).toBe("https://example.org");
    expect(r.raw.citeKey).toBe("smith2020");
    expect(r.raw.entryType).toBe("article");
  });

  it("parses multiple entries and extracts NCT ids from notes", () => {
    const text = `@article{a, title={One}, year={2021}}
      @misc{b, title={Trial}, note={NCT01234567}}`;
    const refs = parseBibTeX(text);
    expect(refs).toHaveLength(2);
    expect(refs[1].nctId).toBe("NCT01234567");
  });

  it("returns an empty array for junk input", () => {
    expect(parseBibTeX("no entries here")).toEqual([]);
  });
});

describe("parseRIS", () => {
  it("parses a JOUR record with multiple authors", () => {
    const text = [
      "TY  - JOUR",
      "TI  - A Trial Report",
      "AU  - Smith, J",
      "AU  - Doe, J",
      "PY  - 2019",
      "JO  - Lancet",
      "DO  - 10.1/abc",
      "UR  - https://ex.org",
      "AN  - 12345678",
      "ER  - ",
    ].join("\n");
    const refs = parseRIS(text);
    expect(refs).toHaveLength(1);
    const r = refs[0];
    expect(r.title).toBe("A Trial Report");
    expect(r.authors).toEqual(["Smith, J", "Doe, J"]);
    expect(r.year).toBe(2019);
    expect(r.journal).toBe("Lancet");
    expect(r.doi).toBe("10.1/abc");
    expect(r.pmid).toBe("12345678");
  });

  it("parses multiple records split by ER", () => {
    const text = "TY  - JOUR\nTI  - One\nER  - \nTY  - JOUR\nTI  - Two\nER  - ";
    const refs = parseRIS(text);
    expect(refs).toHaveLength(2);
    expect(refs.map((r) => r.title)).toEqual(["One", "Two"]);
  });
});

describe("serializers", () => {
  const ref = asReference({
    title: "Drug X Efficacy",
    authors: ["Smith, Jane", "Doe, John"],
    year: 2022,
    journal: "NEJM",
    doi: "10.1/x",
    pmid: "999",
    url: "https://ex.org",
    raw: { citeKey: "smith2022" },
  });

  it("serializes BibTeX and round-trips key fields", () => {
    const doc = serializeBibTeX([ref]);
    expect(doc).toContain("@article{smith2022,");
    expect(doc).toContain("title = {Drug X Efficacy}");
    expect(doc).toContain("author = {Smith, Jane and Doe, John}");
    const reparsed = parseBibTeX(doc);
    expect(reparsed[0].title).toBe("Drug X Efficacy");
    expect(reparsed[0].year).toBe(2022);
  });

  it("serializes RIS and round-trips key fields", () => {
    const doc = serializeRIS([ref]);
    expect(doc).toContain("TY  - JOUR");
    expect(doc).toContain("TI  - Drug X Efficacy");
    const reparsed = parseRIS(doc);
    expect(reparsed[0].authors).toEqual(["Smith, Jane", "Doe, John"]);
  });

  it("serializes CSV with header and escaped commas", () => {
    const doc = serializeCSV([ref]);
    const lines = doc.trim().split("\r\n");
    expect(lines[0]).toBe("type,title,authors,year,journal,doi,pmid,nct_id,url");
    // authors joined by '; ' so no comma escaping needed here, but title has none either
    expect(lines[1]).toContain("Drug X Efficacy");
    expect(lines[1]).toContain("Smith, Jane; Doe, John".replace(/,/g, ","));
  });

  it("quotes CSV cells containing commas", () => {
    const withComma = asReference({ title: "A, B, C", authors: [] });
    const doc = serializeCSV([withComma]);
    expect(doc).toContain('"A, B, C"');
  });
});
