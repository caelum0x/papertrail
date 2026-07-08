import { describe, expect, it } from "vitest";
import { parseSourceId } from "../lib/sourceId";

describe("parseSourceId", () => {
  describe("PMID", () => {
    it("parses a bare PMID (digits only)", () => {
      expect(parseSourceId("36449413")).toEqual({
        kind: "pmid",
        id: "36449413",
        url: "https://pubmed.ncbi.nlm.nih.gov/36449413/",
      });
    });

    it("parses a labeled PMID", () => {
      expect(parseSourceId("PMID: 36449413")).toEqual({
        kind: "pmid",
        id: "36449413",
        url: "https://pubmed.ncbi.nlm.nih.gov/36449413/",
      });
    });

    it("parses a labeled PMID without a space", () => {
      expect(parseSourceId("pmid:12345678")).toEqual({
        kind: "pmid",
        id: "12345678",
        url: "https://pubmed.ncbi.nlm.nih.gov/12345678/",
      });
    });
  });

  describe("NCT", () => {
    it("parses an NCT id", () => {
      expect(parseSourceId("NCT01206062")).toEqual({
        kind: "nct",
        id: "NCT01206062",
        url: "https://clinicaltrials.gov/study/NCT01206062",
      });
    });

    it("normalizes a lowercase NCT id to uppercase", () => {
      expect(parseSourceId("nct01206062")).toEqual({
        kind: "nct",
        id: "NCT01206062",
        url: "https://clinicaltrials.gov/study/NCT01206062",
      });
    });
  });

  describe("DOI", () => {
    it("parses a bare DOI", () => {
      expect(parseSourceId("10.1056/NEJMoa2034577")).toEqual({
        kind: "doi",
        id: "10.1056/nejmoa2034577",
        url: "https://doi.org/10.1056/nejmoa2034577",
      });
    });

    it("parses a doi:-prefixed DOI", () => {
      expect(parseSourceId("doi:10.1056/NEJMoa2034577")).toEqual({
        kind: "doi",
        id: "10.1056/nejmoa2034577",
        url: "https://doi.org/10.1056/nejmoa2034577",
      });
    });

    it("parses a doi.org URL", () => {
      expect(parseSourceId("https://doi.org/10.1056/NEJMoa2034577")).toEqual({
        kind: "doi",
        id: "10.1056/nejmoa2034577",
        url: "https://doi.org/10.1056/nejmoa2034577",
      });
    });

    it("parses a dx.doi.org URL", () => {
      expect(parseSourceId("http://dx.doi.org/10.1136/bmj.n1088")).toEqual({
        kind: "doi",
        id: "10.1136/bmj.n1088",
        url: "https://doi.org/10.1136/bmj.n1088",
      });
    });

    it("trims trailing prose punctuation from a DOI", () => {
      expect(parseSourceId("10.1136/bmj.n1088.")).toEqual({
        kind: "doi",
        id: "10.1136/bmj.n1088",
        url: "https://doi.org/10.1136/bmj.n1088",
      });
    });
  });

  describe("whitespace", () => {
    it("trims surrounding whitespace", () => {
      expect(parseSourceId("  NCT01206062  ")).toEqual({
        kind: "nct",
        id: "NCT01206062",
        url: "https://clinicaltrials.gov/study/NCT01206062",
      });
    });
  });

  describe("null cases", () => {
    it("returns null for empty input", () => {
      expect(parseSourceId("")).toBeNull();
    });

    it("returns null for whitespace-only input", () => {
      expect(parseSourceId("   ")).toBeNull();
    });

    it("returns null for junk with no recognizable identifier", () => {
      expect(parseSourceId("not an identifier")).toBeNull();
    });
  });
});
