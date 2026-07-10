import { describe, it, expect } from "vitest";
import { groundSourceEvidence, groundAnswer, type ReadSource } from "../lib/paperqa/ask";
import type { SourceCandidate } from "../lib/schemas";
import type { SourceEvidence, CitedAnswer } from "../lib/paperqa/schemas";

// Oracle test for the Paper QA TRUST LAYER: no DB and no LLM. It proves the
// grounding invariant that makes heavy Claude use safe — a cited quote that is a
// real substring of the source survives (with correct offsets), and a fabricated
// quote is dropped. A claim that loses all its citations is not shown.

const RAW =
  "In the CLARITY-AD trial, lecanemab reduced clinical decline on the CDR-SB by 0.45 points versus placebo at 18 months. ARIA-E occurred in 12.6% of the lecanemab group.";

const source: SourceCandidate = {
  id: "00000000-0000-0000-0000-000000000001",
  source_type: "pubmed",
  external_id: "12345678",
  title: "CLARITY-AD",
  raw_text: RAW,
  url: "https://pubmed.ncbi.nlm.nih.gov/12345678/",
  similarity: 0.9,
};

describe("groundSourceEvidence", () => {
  it("keeps a verbatim snippet with correct offsets and drops a fabricated one", () => {
    const evidence: SourceEvidence = {
      relevant: true,
      snippets: [
        {
          quote: "lecanemab reduced clinical decline on the CDR-SB by 0.45 points",
          relevance: "Gives the effect size on the primary endpoint.",
          supports: "answers",
        },
        {
          quote: "lecanemab cured 90% of patients", // not in the source
          relevance: "Fabricated — must be dropped.",
          supports: "answers",
        },
      ],
    };

    const read = groundSourceEvidence(0, source, evidence);
    expect(read.evidence).toHaveLength(1);
    const kept = read.evidence[0];
    expect(RAW.slice(kept.grounding.start, kept.grounding.end)).toBe(kept.located_text);
    expect(kept.located_text).toContain("0.45 points");
  });
});

describe("groundAnswer", () => {
  const read: ReadSource = groundSourceEvidence(0, source, {
    relevant: true,
    snippets: [
      {
        quote: "ARIA-E occurred in 12.6% of the lecanemab group",
        relevance: "Safety signal.",
        supports: "context",
      },
    ],
  });

  it("keeps a grounded claim and drops a claim whose only citation is fabricated", () => {
    const answer: CitedAnswer = {
      answer_claims: [
        {
          text: "ARIA-E occurred in 12.6% of the treated group.",
          citations: [
            { source_index: 0, quote: "ARIA-E occurred in 12.6% of the lecanemab group" },
          ],
        },
        {
          text: "The drug cured almost all patients.",
          citations: [{ source_index: 0, quote: "lecanemab cured 90% of patients" }],
        },
      ],
      insufficient: false,
      caveat: "",
    };

    const rawByIndex = new Map<number, string>([[0, RAW]]);
    const { claims, dropped } = groundAnswer(answer, [read], rawByIndex);

    expect(claims).toHaveLength(1);
    expect(dropped).toBe(1);
    const cite = claims[0].citations[0];
    expect(RAW.slice(cite.grounding.start, cite.grounding.end)).toBe(cite.quote);
    expect(cite.source_id).toBe(source.id);
  });

  it("drops a citation to a source_index that was not provided", () => {
    const answer: CitedAnswer = {
      answer_claims: [
        {
          text: "Claim citing a missing source.",
          citations: [{ source_index: 7, quote: "ARIA-E occurred in 12.6% of the lecanemab group" }],
        },
      ],
      insufficient: false,
      caveat: "",
    };
    const { claims, dropped } = groundAnswer(answer, [read], new Map([[0, RAW]]));
    expect(claims).toHaveLength(0);
    expect(dropped).toBe(1);
  });
});
