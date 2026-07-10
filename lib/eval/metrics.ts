// Pure, deterministic classification metrics for the SciFact benchmark.
//
// No I/O, no API, no DB — every function here is a total function over its
// inputs and is fully unit-testable in isolation. This is the numeric core the
// eval harness renders into a report: given (gold, pred) label pairs it produces
// a confusion matrix, per-class precision/recall/F1, and the macro/micro/accuracy
// roll-ups. All divisions guard against zero (a metric with no denominator is 0,
// never NaN), so an empty or degenerate run still yields a clean, printable table.
//
// Labels are the PaperTrail-mapped SciFact verdicts: a source that SUPPORTs the
// claim, one that CONTRADICTs it, or NEI when no confident support was found.

/** The three-way classification labels used across the SciFact mapping. */
export const EVAL_LABELS = ["SUPPORT", "CONTRADICT", "NEI"] as const;
export type EvalLabel = (typeof EVAL_LABELS)[number];

/** One graded prediction: the gold (reference) label and the model's guess. */
export interface LabelPair<L extends string = string> {
  gold: L;
  pred: L;
}

/**
 * A confusion matrix over a fixed, ordered label set.
 *
 * `labels` fixes the row/column order. `counts[i][j]` is the number of pairs
 * whose gold label is `labels[i]` and whose predicted label is `labels[j]`
 * (rows = gold/actual, columns = pred). `total` is the number of pairs counted;
 * pairs whose gold or pred label is not in `labels` are ignored and surfaced in
 * `ignored` so the caller can detect an out-of-vocabulary mismatch.
 */
export interface ConfusionMatrix<L extends string = string> {
  labels: readonly L[];
  counts: number[][];
  total: number;
  ignored: number;
}

/** Per-class precision/recall/F1 with the class's support (gold count). */
export interface ClassMetrics<L extends string = string> {
  label: L;
  precision: number;
  recall: number;
  f1: number;
  support: number;
}

/** Safe division: returns 0 (not NaN/Infinity) whenever the denominator is 0. */
function safeDiv(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

/** Harmonic mean of precision and recall, 0 when both are 0. */
function f1FromPR(precision: number, recall: number): number {
  return safeDiv(2 * precision * recall, precision + recall);
}

/**
 * Build a confusion matrix from graded pairs over a fixed label set.
 *
 * Immutable: the input array is not touched. Pairs referencing a label outside
 * `labels` are skipped and counted in `ignored` rather than silently distorting
 * the matrix. Defaults to the SciFact three-way label set.
 */
export function confusionMatrix<L extends string = EvalLabel>(
  pairs: readonly LabelPair<L>[],
  labels: readonly L[] = EVAL_LABELS as unknown as readonly L[]
): ConfusionMatrix<L> {
  const index = new Map<L, number>();
  labels.forEach((label, i) => index.set(label, i));

  const counts: number[][] = labels.map(() => labels.map(() => 0));
  let total = 0;
  let ignored = 0;

  for (const { gold, pred } of pairs) {
    const i = index.get(gold);
    const j = index.get(pred);
    if (i === undefined || j === undefined) {
      ignored += 1;
      continue;
    }
    counts[i][j] += 1;
    total += 1;
  }

  return { labels: [...labels], counts, total, ignored };
}

/**
 * Per-class precision, recall, F1, and support from a confusion matrix.
 *
 * For class c: TP = counts[c][c]; FP = column sum − TP (things predicted c that
 * weren't); FN = row sum − TP (things that were c but predicted otherwise).
 * Support is the row sum (gold count for the class). All ratios are zero-safe.
 */
export function perClassPRF<L extends string = string>(
  matrix: ConfusionMatrix<L>
): ClassMetrics<L>[] {
  const { labels, counts } = matrix;

  return labels.map((label, c) => {
    const tp = counts[c][c];
    const rowSum = counts[c].reduce((a, b) => a + b, 0); // gold = c
    const colSum = counts.reduce((a, row) => a + row[c], 0); // pred = c
    const fp = colSum - tp;
    const fn = rowSum - tp;

    const precision = safeDiv(tp, tp + fp);
    const recall = safeDiv(tp, tp + fn);
    const f1 = f1FromPR(precision, recall);

    return { label, precision, recall, f1, support: rowSum };
  });
}

/** Unweighted mean of per-class F1 (each class counts equally). */
export function macroF1<L extends string = string>(
  matrix: ConfusionMatrix<L>
): number {
  const perClass = perClassPRF(matrix);
  if (perClass.length === 0) return 0;
  const sum = perClass.reduce((a, m) => a + m.f1, 0);
  return sum / perClass.length;
}

/**
 * Micro-averaged F1: precision/recall/F1 computed from the pooled TP/FP/FN
 * across all classes. In a single-label setting where every pair maps to an
 * in-vocabulary class, micro-F1 equals accuracy — but the pooled formulation is
 * kept explicit and zero-safe so it stays correct on degenerate/partial runs.
 */
export function microF1<L extends string = string>(
  matrix: ConfusionMatrix<L>
): number {
  const { labels, counts } = matrix;
  let tp = 0;
  let fp = 0;
  let fn = 0;

  labels.forEach((_, c) => {
    const classTp = counts[c][c];
    const rowSum = counts[c].reduce((a, b) => a + b, 0);
    const colSum = counts.reduce((a, row) => a + row[c], 0);
    tp += classTp;
    fp += colSum - classTp;
    fn += rowSum - classTp;
  });

  const precision = safeDiv(tp, tp + fp);
  const recall = safeDiv(tp, tp + fn);
  return f1FromPR(precision, recall);
}

/** Overall accuracy: trace (correct predictions) over total counted pairs. */
export function accuracy<L extends string = string>(
  matrix: ConfusionMatrix<L>
): number {
  const trace = matrix.labels.reduce((a, _, c) => a + matrix.counts[c][c], 0);
  return safeDiv(trace, matrix.total);
}

/** Everything the report needs in one pass, so callers don't re-derive it. */
export interface MetricsSummary<L extends string = string> {
  matrix: ConfusionMatrix<L>;
  perClass: ClassMetrics<L>[];
  macroF1: number;
  microF1: number;
  accuracy: number;
}

/** Compute the full metrics summary from graded pairs in one call. */
export function computeMetrics<L extends string = EvalLabel>(
  pairs: readonly LabelPair<L>[],
  labels: readonly L[] = EVAL_LABELS as unknown as readonly L[]
): MetricsSummary<L> {
  const matrix = confusionMatrix(pairs, labels);
  return {
    matrix,
    perClass: perClassPRF(matrix),
    macroF1: macroF1(matrix),
    microF1: microF1(matrix),
    accuracy: accuracy(matrix),
  };
}

function pct(x: number): string {
  return (x * 100).toFixed(1);
}

/**
 * Render a metrics summary as a self-contained Markdown report: a per-class
 * precision/recall/F1/support table followed by the confusion matrix and the
 * headline macro-F1 / micro-F1 / accuracy line. Pure string building — no I/O.
 */
export function formatMetricsTable<L extends string = string>(
  summary: MetricsSummary<L>,
  opts: { title?: string } = {}
): string {
  const { matrix, perClass } = summary;
  const lines: string[] = [];

  if (opts.title) {
    lines.push(`### ${opts.title}`, "");
  }

  // Per-class precision / recall / F1 / support.
  lines.push("| Label | Precision | Recall | F1 | Support |");
  lines.push("| --- | ---: | ---: | ---: | ---: |");
  for (const m of perClass) {
    lines.push(
      `| ${m.label} | ${pct(m.precision)} | ${pct(m.recall)} | ${pct(m.f1)} | ${m.support} |`
    );
  }
  lines.push(
    `| **macro** | | | ${pct(summary.macroF1)} | ${matrix.total} |`,
    `| **micro** | | | ${pct(summary.microF1)} | ${matrix.total} |`
  );
  lines.push("");

  // Confusion matrix (rows = gold, columns = predicted).
  const header = ["gold ↓ / pred →", ...matrix.labels].join(" | ");
  const divider = ["---", ...matrix.labels.map(() => "---:")].join(" | ");
  lines.push(`| ${header} |`);
  lines.push(`| ${divider} |`);
  matrix.labels.forEach((label, i) => {
    lines.push(`| ${label} | ${matrix.counts[i].join(" | ")} |`);
  });
  lines.push("");

  lines.push(
    `**Accuracy:** ${pct(summary.accuracy)}%  ·  **Macro-F1:** ${pct(
      summary.macroF1
    )}%  ·  **Micro-F1:** ${pct(summary.microF1)}%  ·  **N:** ${matrix.total}` +
      (matrix.ignored > 0 ? `  ·  (ignored ${matrix.ignored} out-of-label pairs)` : "")
  );

  return lines.join("\n");
}
