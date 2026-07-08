import { describe, expect, it } from "vitest";
import {
  CitationSource,
  toBibTeX,
  toPlainCitation,
  toRIS,
} from "../lib/citationFormats";

const pubmed: CitationSource = {
  title: "Effect of Drug X on cardiovascular events",
  url: "https://pubmed.ncbi.nlm.nih.gov/36449413/",
  source_type: "pubmed",
  external_id: "36449413",
};

const trial: CitationSource = {
  title: "A Randomized Trial of Drug X",
  url: "https://clinicaltrials.gov/study/NCT01206062",
  source_type: "clinicaltrials",
  external_id: "NCT01206062",
};

describe("toBibTeX", () => {
  it("includes the title, url, and PMID for a pubmed source", () => {
    const out = toBibTeX(pubmed);
    expect(out).toContain("@article{");
    expect(out).toContain(pubmed.title);
    expect(out).toContain(pubmed.url);
    expect(out).toContain("36449413");
  });

  it("includes the title, url, and NCT for a trial source (as @misc with howpublished)", () => {
    const out = toBibTeX(trial);
    expect(out).toContain("@misc{");
    expect(out).toContain(trial.title);
    expect(out).toContain(trial.url);
    expect(out).toContain("NCT01206062");
    expect(out).toContain("howpublished");
  });

  it("is deterministic", () => {
    expect(toBibTeX(pubmed)).toBe(toBibTeX(pubmed));
  });
});

describe("toRIS", () => {
  it("includes TY JOUR, title, url, and PMID for a pubmed source", () => {
    const out = toRIS(pubmed);
    expect(out).toContain("TY  - JOUR");
    expect(out).toContain(`TI  - ${pubmed.title}`);
    expect(out).toContain(`UR  - ${pubmed.url}`);
    expect(out).toContain("36449413");
    expect(out).toContain("ER  - ");
  });

  it("includes TY RPRT, title, url, and NCT for a trial source", () => {
    const out = toRIS(trial);
    expect(out).toContain("TY  - RPRT");
    expect(out).toContain(`TI  - ${trial.title}`);
    expect(out).toContain(`UR  - ${trial.url}`);
    expect(out).toContain("NCT01206062");
  });
});

describe("toPlainCitation", () => {
  it("includes the title, PMID, and url for a pubmed source", () => {
    const out = toPlainCitation(pubmed);
    expect(out).toContain(pubmed.title);
    expect(out).toContain("36449413");
    expect(out).toContain(pubmed.url);
  });

  it("includes the title, NCT, and url for a trial source", () => {
    const out = toPlainCitation(trial);
    expect(out).toContain(trial.title);
    expect(out).toContain("NCT01206062");
    expect(out).toContain(trial.url);
  });
});

describe("graceful degradation", () => {
  const noId: CitationSource = {
    title: "Untitled-ish but present",
    url: "https://pubmed.ncbi.nlm.nih.gov/1/",
    source_type: "pubmed",
  };

  const noTitle: CitationSource = {
    title: null,
    url: "https://clinicaltrials.gov/study/NCT99999999",
    source_type: "clinicaltrials",
    external_id: "NCT99999999",
  };

  it("does not throw when external_id is missing", () => {
    expect(() => toBibTeX(noId)).not.toThrow();
    expect(() => toRIS(noId)).not.toThrow();
    expect(() => toPlainCitation(noId)).not.toThrow();
  });

  it("omits id fields when external_id is missing", () => {
    expect(toRIS(noId)).not.toContain("ID  - ");
    expect(toBibTeX(noId)).not.toContain("note");
  });

  it('falls back to "Untitled source" for a null title', () => {
    expect(toBibTeX(noTitle)).toContain("Untitled source");
    expect(toRIS(noTitle)).toContain("Untitled source");
    expect(toPlainCitation(noTitle)).toContain("Untitled source");
  });

  it("still produces a stable cite key from the title when no external_id", () => {
    expect(toBibTeX(noId)).toBe(toBibTeX(noId));
    expect(toBibTeX(noId)).toContain("@article{papertrail_");
  });
});
