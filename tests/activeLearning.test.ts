import { describe, it, expect } from "vitest";
import {
  tokenize,
  fitTfidf,
  transformTfidf,
  fitNaiveBayes,
  predictRelevance,
  maxQuery,
  rankRecordsAL,
  type ALRecord,
  type ALLabel,
  type SparseRow,
} from "../lib/screening/activeLearning";

// Native TS port of the ASReview active-learning core (Tfidf + NaiveBayes + Max).
// These tests lock the ported math to sklearn-faithful behaviour and assert the
// real ASReview loop: a term the reviewer labeled RELEVANT should push its
// unlabeled matches to the top of the ranking.

describe("tokenize — sklearn token_pattern \\b\\w\\w+\\b, lowercased", () => {
  it("keeps 2+ char word tokens and lowercases", () => {
    expect(tokenize("Aspirin reduced MI events")).toEqual([
      "aspirin",
      "reduced",
      "mi",
      "events",
    ]);
  });

  it("drops single-char tokens and punctuation", () => {
    // "a", "b", "e", "f" are single-char → dropped; "cc", "dd" survive.
    expect(tokenize("a b cc, dd. e-f")).toEqual(["cc", "dd"]);
  });

  it("splits on hyphens and punctuation into separate tokens", () => {
    // "e-f" → "e","f" are single-char, dropped. "well-known" → "well","known".
    expect(tokenize("well-known drug-drug")).toEqual([
      "well",
      "known",
      "drug",
      "drug",
    ]);
  });
});

describe("fitTfidf — sklearn TfidfVectorizer defaults (smooth_idf, sorted vocab)", () => {
  it("assigns vocabulary indices in sorted term order", () => {
    const model = fitTfidf(["banana apple", "cherry"]);
    expect([...model.vocabulary.keys()]).toEqual(["apple", "banana", "cherry"]);
    expect(model.vocabulary.get("apple")).toBe(0);
    expect(model.vocabulary.get("banana")).toBe(1);
    expect(model.vocabulary.get("cherry")).toBe(2);
  });

  it("computes smoothed idf = ln((1+n)/(1+df)) + 1", () => {
    // n = 2 documents. "apple" appears in 1 doc → idf = ln(3/2)+1 = 1.405465108...
    // "cherry" appears in 1 doc → same. A term in both docs → ln(3/3)+1 = 1.
    const model = fitTfidf(["apple cherry", "apple"]);
    const apple = model.vocabulary.get("apple")!;
    const cherry = model.vocabulary.get("cherry")!;
    // apple in both docs (df=2): idf = ln(3/3)+1 = 1.
    expect(model.idf[apple]).toBeCloseTo(1.0, 10);
    // cherry in one doc (df=1): idf = ln(3/2)+1.
    expect(model.idf[cherry]).toBeCloseTo(Math.log(3 / 2) + 1, 10);
  });
});

describe("transformTfidf — L2-normalised tf*idf rows", () => {
  it("produces an L2-normalised row (unit length) for a non-empty doc", () => {
    const model = fitTfidf(["apple banana", "banana cherry"]);
    const row = transformTfidf(model, "apple banana");
    let sumSq = 0;
    for (const v of row.values()) sumSq += v * v;
    expect(Math.sqrt(sumSq)).toBeCloseTo(1.0, 10);
  });

  it("drops out-of-vocabulary tokens", () => {
    const model = fitTfidf(["apple banana"]);
    const row = transformTfidf(model, "apple zebra");
    // "zebra" is OOV → only "apple" survives → single-element unit vector.
    expect(row.size).toBe(1);
    const apple = model.vocabulary.get("apple")!;
    expect(row.get(apple)).toBeCloseTo(1.0, 10);
  });

  it("returns a zero row for an all-OOV / empty document", () => {
    const model = fitTfidf(["apple banana"]);
    expect(transformTfidf(model, "zebra yak").size).toBe(0);
    expect(transformTfidf(model, "").size).toBe(0);
  });
});

describe("fitNaiveBayes + predictRelevance — MultinomialNB alpha=1", () => {
  it("predicts higher relevance for a row sharing the relevant class's features", () => {
    const model = fitTfidf(["statin cholesterol", "gardening flowers"]);
    const nFeatures = model.vocabulary.size;
    const rows: SparseRow[] = [
      transformTfidf(model, "statin cholesterol"),
      transformTfidf(model, "gardening flowers"),
    ];
    const nb = fitNaiveBayes(rows, [1, 0], nFeatures);

    const relevantLike = transformTfidf(model, "statin cholesterol");
    const irrelevantLike = transformTfidf(model, "gardening flowers");
    expect(predictRelevance(nb, relevantLike)).toBeGreaterThan(0.5);
    expect(predictRelevance(nb, irrelevantLike)).toBeLessThan(0.5);
  });

  it("throws on no labeled rows", () => {
    expect(() => fitNaiveBayes([], [], 3)).toThrow(/no labeled records/i);
  });

  it("throws on misaligned rows and labels", () => {
    const model = fitTfidf(["apple"]);
    const row = transformTfidf(model, "apple");
    expect(() => fitNaiveBayes([row], [1, 0], model.vocabulary.size)).toThrow(
      /misaligned/i
    );
  });
});

describe("maxQuery — descending relevance, stable on ties", () => {
  it("orders most-relevant-first", () => {
    const ranked = maxQuery([
      { id: "a", relevance: 0.2 },
      { id: "b", relevance: 0.9 },
      { id: "c", relevance: 0.5 },
    ]);
    expect(ranked.map((r) => r.id)).toEqual(["b", "c", "a"]);
  });

  it("preserves input order on equal relevance (stable)", () => {
    const ranked = maxQuery([
      { id: "x", relevance: 0.5 },
      { id: "y", relevance: 0.5 },
      { id: "z", relevance: 0.5 },
    ]);
    expect(ranked.map((r) => r.id)).toEqual(["x", "y", "z"]);
  });
});

describe("rankRecordsAL — the real ASReview loop on a fixed toy corpus", () => {
  // A labeled-relevant term ("statin") should rank its UNLABELED matches first.
  const records: ALRecord[] = [
    { id: "L1", title: "Statin therapy lowers LDL cholesterol", abstract: "randomized statin trial" },
    { id: "L2", title: "Community gardening improves wellbeing", abstract: "urban gardening survey" },
    { id: "U1", title: "Effect of gardening on mood", abstract: "gardening leisure activity outdoors" },
    { id: "U2", title: "Statin adherence in secondary prevention", abstract: "statin cardiovascular cohort" },
    { id: "U3", title: "Statin use and muscle symptoms", abstract: "statin myopathy observational" },
  ];
  const labeled: ALLabel[] = [
    { id: "L1", label01: 1 }, // "statin" → relevant
    { id: "L2", label01: 0 }, // "gardening" → irrelevant
  ];

  it("ranks unlabeled statin records above the unlabeled gardening record", () => {
    const result = rankRecordsAL(records, labeled);

    const ids = result.ranking.map((r) => r.id);
    // Only the three UNLABELED records are ranked; labeled ones are excluded.
    expect(ids.sort()).toEqual(["U1", "U2", "U3"]);

    const rank = new Map(result.ranking.map((r, i) => [r.id, i]));
    // Both "statin" unlabeled records rank ABOVE the "gardening" unlabeled one.
    expect(rank.get("U2")!).toBeLessThan(rank.get("U1")!);
    expect(rank.get("U3")!).toBeLessThan(rank.get("U1")!);

    // Statin matches score clearly relevant; the gardening match clearly not.
    const byId = new Map(result.ranking.map((r) => [r.id, r.relevance]));
    expect(byId.get("U2")!).toBeGreaterThan(0.5);
    expect(byId.get("U3")!).toBeGreaterThan(0.5);
    expect(byId.get("U1")!).toBeLessThan(0.5);
  });

  it("reports honest diagnostic meta counts", () => {
    const result = rankRecordsAL(records, labeled);
    expect(result.meta.labeled).toBe(2);
    expect(result.meta.relevantLabels).toBe(1);
    expect(result.meta.irrelevantLabels).toBe(1);
    expect(result.meta.unlabeled).toBe(3);
    expect(result.meta.vocabularySize).toBeGreaterThan(0);
  });

  it("returns an empty ranking when there is nothing to learn from", () => {
    const result = rankRecordsAL(records, []);
    expect(result.ranking).toEqual([]);
    expect(result.meta.labeled).toBe(0);
  });

  it("returns an empty ranking when every record is already labeled", () => {
    const allLabeled: ALLabel[] = records.map((r) => ({ id: r.id, label01: 1 }));
    const result = rankRecordsAL(records, allLabeled);
    expect(result.ranking).toEqual([]);
    expect(result.meta.unlabeled).toBe(0);
  });

  it("is deterministic — identical inputs yield an identical ranking", () => {
    const a = rankRecordsAL(records, labeled);
    const b = rankRecordsAL(records, labeled);
    expect(a.ranking).toEqual(b.ranking);
  });

  it("does not mutate its inputs", () => {
    const recordsCopy = structuredClone(records);
    const labeledCopy = structuredClone(labeled);
    rankRecordsAL(records, labeled);
    expect(records).toEqual(recordsCopy);
    expect(labeled).toEqual(labeledCopy);
  });
});
