import { describe, it, expect } from "vitest";
import {
  confusionMatrix,
  perClassPRF,
  macroF1,
  microF1,
  accuracy,
  computeMetrics,
  formatMetricsTable,
  EVAL_LABELS,
  type EvalLabel,
  type LabelPair,
} from "@/lib/eval/metrics";

// A small, fixed, hand-computed set of (gold, pred) pairs whose confusion matrix,
// per-class P/R/F1, accuracy, and macro/micro-F1 are worked out below by hand.
// This is the oracle: if the arithmetic in metrics.ts drifts, these exact numbers
// break. Deliberately asymmetric so precision != recall per class (no coincidences).
//
// Confusion matrix (rows = gold, cols = pred), labels [SUPPORT, CONTRADICT, NEI]:
//
//              pred:S  pred:C  pred:N   (gold support)
//   gold S  [   5   ,   1   ,   0   ]      6
//   gold C  [   2   ,   2   ,   0   ]      4
//   gold N  [   1   ,   0   ,   1   ]      2
//   total = 12, trace (correct) = 5 + 2 + 1 = 8
//
// SUPPORT:    TP=5 FP=3 FN=1 -> P=5/8=0.625     R=5/6=0.833..  F1=0.71428..
// CONTRADICT: TP=2 FP=1 FN=2 -> P=2/3=0.666..   R=2/4=0.5      F1=0.57142..
// NEI:        TP=1 FP=0 FN=1 -> P=1/1=1.0       R=1/2=0.5      F1=0.66666..
// accuracy = 8/12 = 0.66666..
// macro-F1 = (0.714285 + 0.571428 + 0.666666) / 3 = 0.650793..
// micro: pooled TP=8 FP=4 FN=4 -> P=R=F1 = 8/12 = 0.66666..
const PAIRS: LabelPair<EvalLabel>[] = [
  // 5x SUPPORT -> SUPPORT
  { gold: "SUPPORT", pred: "SUPPORT" },
  { gold: "SUPPORT", pred: "SUPPORT" },
  { gold: "SUPPORT", pred: "SUPPORT" },
  { gold: "SUPPORT", pred: "SUPPORT" },
  { gold: "SUPPORT", pred: "SUPPORT" },
  // 1x SUPPORT -> CONTRADICT
  { gold: "SUPPORT", pred: "CONTRADICT" },
  // 2x CONTRADICT -> SUPPORT
  { gold: "CONTRADICT", pred: "SUPPORT" },
  { gold: "CONTRADICT", pred: "SUPPORT" },
  // 2x CONTRADICT -> CONTRADICT
  { gold: "CONTRADICT", pred: "CONTRADICT" },
  { gold: "CONTRADICT", pred: "CONTRADICT" },
  // 1x NEI -> SUPPORT
  { gold: "NEI", pred: "SUPPORT" },
  // 1x NEI -> NEI
  { gold: "NEI", pred: "NEI" },
];

describe("confusionMatrix", () => {
  it("counts gold x pred into the fixed [SUPPORT, CONTRADICT, NEI] grid", () => {
    const m = confusionMatrix(PAIRS);
    expect(m.labels).toEqual(["SUPPORT", "CONTRADICT", "NEI"]);
    expect(m.counts).toEqual([
      [5, 1, 0],
      [2, 2, 0],
      [1, 0, 1],
    ]);
    expect(m.total).toBe(12);
    expect(m.ignored).toBe(0);
  });

  it("does not mutate the input pairs", () => {
    const input: LabelPair<EvalLabel>[] = [{ gold: "SUPPORT", pred: "NEI" }];
    const snapshot = JSON.stringify(input);
    confusionMatrix(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it("ignores pairs whose labels fall outside the label set", () => {
    const m = confusionMatrix<string>(
      [
        { gold: "SUPPORT", pred: "SUPPORT" },
        { gold: "SUPPORT", pred: "WEIRD" },
        { gold: "OFF", pred: "NEI" },
      ],
      EVAL_LABELS as unknown as string[]
    );
    expect(m.total).toBe(1);
    expect(m.ignored).toBe(2);
    expect(m.counts[0][0]).toBe(1);
  });
});

describe("perClassPRF (oracle values)", () => {
  const perClass = perClassPRF(confusionMatrix(PAIRS));
  const byLabel = Object.fromEntries(perClass.map((m) => [m.label, m]));

  it("SUPPORT: P=0.625, R=5/6, F1=0.714286, support=6", () => {
    const s = byLabel.SUPPORT;
    expect(s.precision).toBeCloseTo(0.625, 10);
    expect(s.recall).toBeCloseTo(5 / 6, 10);
    expect(s.f1).toBeCloseTo(0.7142857142857143, 10);
    expect(s.support).toBe(6);
  });

  it("CONTRADICT: P=2/3, R=0.5, F1=0.571429, support=4", () => {
    const c = byLabel.CONTRADICT;
    expect(c.precision).toBeCloseTo(2 / 3, 10);
    expect(c.recall).toBeCloseTo(0.5, 10);
    expect(c.f1).toBeCloseTo(0.5714285714285714, 10);
    expect(c.support).toBe(4);
  });

  it("NEI: P=1.0, R=0.5, F1=0.666667, support=2", () => {
    const n = byLabel.NEI;
    expect(n.precision).toBeCloseTo(1.0, 10);
    expect(n.recall).toBeCloseTo(0.5, 10);
    expect(n.f1).toBeCloseTo(0.6666666666666666, 10);
    expect(n.support).toBe(2);
  });
});

describe("aggregate metrics (oracle values)", () => {
  const m = confusionMatrix(PAIRS);

  it("accuracy = 8/12", () => {
    expect(accuracy(m)).toBeCloseTo(8 / 12, 10);
  });

  it("macro-F1 = mean of per-class F1", () => {
    const expected =
      (0.7142857142857143 + 0.5714285714285714 + 0.6666666666666666) / 3;
    expect(macroF1(m)).toBeCloseTo(expected, 10);
    expect(macroF1(m)).toBeCloseTo(0.6507936507936508, 10);
  });

  it("micro-F1 = accuracy in the single-label case (8/12)", () => {
    expect(microF1(m)).toBeCloseTo(8 / 12, 10);
  });
});

describe("zero-division handling", () => {
  it("returns 0 (not NaN) for an empty pair set", () => {
    const m = confusionMatrix([]);
    expect(m.total).toBe(0);
    const perClass = perClassPRF(m);
    for (const c of perClass) {
      expect(c.precision).toBe(0);
      expect(c.recall).toBe(0);
      expect(c.f1).toBe(0);
      expect(c.support).toBe(0);
      expect(Number.isNaN(c.f1)).toBe(false);
    }
    expect(accuracy(m)).toBe(0);
    expect(macroF1(m)).toBe(0);
    expect(microF1(m)).toBe(0);
  });

  it("a class never predicted has precision 0, not NaN", () => {
    // NEI is gold twice but never predicted -> TP=0, FP=0 -> precision div-by-zero.
    const pairs: LabelPair<EvalLabel>[] = [
      { gold: "NEI", pred: "SUPPORT" },
      { gold: "NEI", pred: "SUPPORT" },
      { gold: "SUPPORT", pred: "SUPPORT" },
    ];
    const nei = perClassPRF(confusionMatrix(pairs)).find(
      (c) => c.label === "NEI"
    )!;
    expect(nei.precision).toBe(0);
    expect(nei.recall).toBe(0);
    expect(nei.f1).toBe(0);
    expect(Number.isNaN(nei.precision)).toBe(false);
  });

  it("perfect classification scores 1.0 across the board", () => {
    const pairs: LabelPair<EvalLabel>[] = [
      { gold: "SUPPORT", pred: "SUPPORT" },
      { gold: "CONTRADICT", pred: "CONTRADICT" },
      { gold: "NEI", pred: "NEI" },
    ];
    const m = confusionMatrix(pairs);
    expect(accuracy(m)).toBe(1);
    expect(macroF1(m)).toBe(1);
    expect(microF1(m)).toBe(1);
  });
});

describe("computeMetrics + formatMetricsTable", () => {
  const summary = computeMetrics(PAIRS);

  it("bundles matrix, per-class, and aggregates consistently", () => {
    expect(summary.matrix.total).toBe(12);
    expect(summary.perClass).toHaveLength(3);
    expect(summary.accuracy).toBeCloseTo(8 / 12, 10);
    expect(summary.macroF1).toBeCloseTo(0.6507936507936508, 10);
  });

  it("renders a markdown table with the headline numbers", () => {
    const md = formatMetricsTable(summary, { title: "SciFact dev" });
    expect(md).toContain("### SciFact dev");
    expect(md).toContain("| Label | Precision | Recall | F1 | Support |");
    expect(md).toContain("SUPPORT");
    expect(md).toContain("CONTRADICT");
    expect(md).toContain("NEI");
    // 8/12 = 66.7%, macro 65.1%
    expect(md).toContain("**Accuracy:** 66.7%");
    expect(md).toContain("**Macro-F1:** 65.1%");
    expect(md).toContain("**N:** 12");
  });

  it("notes ignored out-of-label pairs in the footer", () => {
    const s = computeMetrics<string>(
      [
        { gold: "SUPPORT", pred: "SUPPORT" },
        { gold: "BOGUS", pred: "SUPPORT" },
      ],
      EVAL_LABELS as unknown as string[]
    );
    const md = formatMetricsTable(s);
    expect(md).toContain("ignored 1 out-of-label pairs");
  });
});
