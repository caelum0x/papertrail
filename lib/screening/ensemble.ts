// Native TypeScript mirror of the PaperTrail ASReview ENSEMBLE screener
// (backend/engines/asreview/papertrail_ensemble.py).
//
// Upstream ASReview screens systematic-review abstracts on ONE axis — relevant vs.
// irrelevant — via TfidfVectorizer -> MultinomialNB -> Max query (ported in
// lib/screening/activeLearning.ts). PaperTrail's reviewers need three judgements per
// abstract in a single pass:
//
//   * INCLUDE / exclude        (is this study in scope?)
//   * HIGH / low QUALITY       (is it methodologically sound?)
//   * LOW / high RISK-OF-BIAS  (can we trust its effect estimate?)
//
// So this module runs ASReview's exact deterministic core THREE times — one independent
// TF-IDF + Multinomial Naive Bayes classifier per axis, over ONE shared vocabulary —
// then combines the three posteriors into ONE screening `priority` and records which
// axis drove it (`decidingAxis`). The reviewer works the highest-priority abstracts
// first.
//
// It REUSES the sklearn-faithful primitives already ported in activeLearning.ts
// (fitTfidf/transformTfidf/fitNaiveBayes/predictRelevance) — that file is NOT edited.
//
// Deterministic, NO LLM: same labels + same unlabeled pool -> same ranking, always.
// Claude never touches a posterior, a priority, or a ranking here. Numeric behaviour
// mirrors the Python step-for-step (see PAPERTRAIL.md for the field-for-field map).

import {
  fitTfidf,
  transformTfidf,
  fitNaiveBayes,
  predictRelevance,
  type SparseRow,
  type NaiveBayesModel,
} from "./activeLearning";

// --- Public contract -------------------------------------------------------

/** The three screening axes, in the fixed order the priority weights them. */
export type ScreeningAxis = "include" | "quality" | "rob";

/**
 * A prior human decision on one abstract.
 *  - `include`: 1 = in scope, 0 = out of scope (required).
 *  - `quality`: 1 = high quality, 0 = low quality (optional).
 *  - `rob`:     1 = HIGH risk of bias, 0 = low risk of bias (optional).
 *
 * NOTE the `rob` polarity: the input encodes HIGH-RoB as 1, but internally the
 * positive (priority-raising) class is LOW-RoB, so a low-RoB abstract scores HIGH on
 * the rob axis — consistent with include/quality where 1 is the "good" outcome.
 */
export interface LabeledAbstract {
  text: string;
  include: 0 | 1;
  quality?: 0 | 1;
  rob?: 0 | 1;
}

/** An abstract to be screened. */
export interface UnlabeledAbstract {
  id: string;
  text: string;
}

/** One screened abstract with its three axis posteriors + combined priority. */
export interface EnsembleScore {
  id: string;
  /** P(in scope) in [0, 1]; 0 when the include axis was not trained. */
  includeScore: number;
  /** P(high quality) in [0, 1]; 0 when the quality axis was not trained. */
  qualityScore: number;
  /** P(low risk of bias) in [0, 1]; 0 when the rob axis was not trained. */
  robScore: number;
  /** Weighted-mean screening priority over the trained axes, in [0, 1]. */
  priority: number;
  /** The axis contributing the largest weighted term to `priority`. */
  decidingAxis: ScreeningAxis | "none";
}

export interface EnsembleResult {
  /** Unlabeled abstracts, highest-priority-first (stable on ties). */
  ranking: EnsembleScore[];
  /** Diagnostic counts — no abstract text, safe to log. */
  meta: {
    labeled: number;
    unlabeled: number;
    vocabularySize: number;
    /** Which axes had enough two-class signal to fit a classifier. */
    axesTrained: ScreeningAxis[];
  };
}

// --- Constants (mirror papertrail_ensemble.py) -----------------------------

const AXES: readonly ScreeningAxis[] = ["include", "quality", "rob"] as const;

// Include dominates (scope is the gate); quality and low-RoB refine ordering in scope.
const AXIS_WEIGHTS: Readonly<Record<ScreeningAxis, number>> = {
  include: 0.5,
  quality: 0.3,
  rob: 0.2,
};

// --- Axis labelling + priority boundary ------------------------------------

/**
 * Map a labeled abstract to the 0/1 positive class for one axis, or null if the
 * abstract carries no label on that axis. `rob` is inverted (positive = low RoB) so
 * every axis shares the convention "1 = the good outcome we want to rank up."
 */
function axisPositive(axis: ScreeningAxis, label: LabeledAbstract): 0 | 1 | null {
  if (axis === "include") return label.include;
  if (axis === "quality") return label.quality ?? null;
  const rob = label.rob;
  if (rob === undefined) return null;
  return rob === 1 ? 0 : 1;
}

/**
 * THE RANKING BOUNDARY (documented in PAPERTRAIL.md): combine the per-axis positive-
 * class posteriors into one screening priority and name the deciding axis.
 *
 * priority = Σ_axis weight[axis]·score[axis]  over the TRAINED axes only, renormalised
 * by the sum of the used weights — so an untrained axis neither helps nor hurts.
 * decidingAxis = the axis with the largest weighted term weight[axis]·score[axis]
 * (ties break by the fixed axis order include > quality > rob).
 *
 * Pure math + rules — no LLM decides the priority or the axis.
 */
function decidePriority(
  scores: ReadonlyMap<ScreeningAxis, number>
): { priority: number; decidingAxis: ScreeningAxis | "none" } {
  const weightedTerms: { axis: ScreeningAxis; term: number }[] = [];
  let weightSum = 0;
  for (const axis of AXES) {
    const score = scores.get(axis);
    if (score === undefined) continue;
    const weight = AXIS_WEIGHTS[axis];
    weightedTerms.push({ axis, term: weight * score });
    weightSum += weight;
  }

  if (weightedTerms.length === 0 || weightSum === 0) {
    return { priority: 0, decidingAxis: "none" };
  }

  const priority =
    weightedTerms.reduce((acc, t) => acc + t.term, 0) / weightSum;

  let decidingAxis = weightedTerms[0].axis;
  let bestTerm = weightedTerms[0].term;
  for (let i = 1; i < weightedTerms.length; i++) {
    if (weightedTerms[i].term > bestTerm) {
      bestTerm = weightedTerms[i].term;
      decidingAxis = weightedTerms[i].axis;
    }
  }
  return { priority, decidingAxis };
}

// --- The ensemble screen ---------------------------------------------------

/**
 * Run the three-axis ASReview ensemble screen and rank the unlabeled abstracts.
 *
 *   1. Fit ONE TF-IDF over all labeled documents (shared vocabulary).
 *   2. For each axis, fit a MultinomialNB over the labeled rows carrying that axis
 *      label. An axis with fewer than both classes present is skipped — honestly
 *      untrained, never a fabricated head.
 *   3. Score every unlabeled abstract's positive-class posterior on each trained axis.
 *   4. Combine into priority + decidingAxis and rank highest-priority-first (stable).
 *
 * Degenerate inputs are handled honestly rather than fabricating a ranking:
 *   - No labeled or no unlabeled abstracts → empty ranking.
 *   - A labeled set with no usable tokens → empty ranking.
 *   - No axis has two-class signal → empty ranking.
 *
 * Pure — allocates fresh structures, mutates no input. Numeric behaviour is identical
 * to backend/engines/asreview/papertrail_ensemble.py for the same batch.
 */
export function ensembleScreen(
  labeled: readonly LabeledAbstract[],
  unlabeled: readonly UnlabeledAbstract[]
): EnsembleResult {
  const axesTrained: ScreeningAxis[] = [];
  const baseMeta = {
    labeled: labeled.length,
    unlabeled: unlabeled.length,
    vocabularySize: 0,
    axesTrained,
  };

  if (labeled.length === 0 || unlabeled.length === 0) {
    return { ranking: [], meta: baseMeta };
  }

  const labeledDocs = labeled.map((l) => l.text);
  const tfidf = fitTfidf(labeledDocs);
  const nFeatures = tfidf.vocabulary.size;
  const meta = { ...baseMeta, vocabularySize: nFeatures };

  if (nFeatures === 0) {
    return { ranking: [], meta };
  }

  const labeledRows = labeledDocs.map((doc) => transformTfidf(tfidf, doc));

  // One NB head per axis, over the subset of labeled rows carrying that axis label.
  const models = new Map<ScreeningAxis, NaiveBayesModel>();
  for (const axis of AXES) {
    const axisRows: SparseRow[] = [];
    const axisLabels: (0 | 1)[] = [];
    labeled.forEach((label, i) => {
      const pos = axisPositive(axis, label);
      if (pos === null) return;
      axisRows.push(labeledRows[i]);
      axisLabels.push(pos);
    });
    // Need both classes present to fit a discriminative head.
    if (new Set(axisLabels).size < 2) continue;
    models.set(axis, fitNaiveBayes(axisRows, axisLabels, nFeatures));
    axesTrained.push(axis);
  }

  if (models.size === 0) {
    return { ranking: [], meta };
  }

  const scored = unlabeled.map((abstract, index) => {
    const row = transformTfidf(tfidf, abstract.text);
    const scores = new Map<ScreeningAxis, number>();
    for (const [axis, model] of models) {
      scores.set(axis, predictRelevance(model, row));
    }
    const { priority, decidingAxis } = decidePriority(scores);
    return {
      score: {
        id: abstract.id,
        includeScore: scores.get("include") ?? 0,
        qualityScore: scores.get("quality") ?? 0,
        robScore: scores.get("rob") ?? 0,
        priority,
        decidingAxis,
      } satisfies EnsembleScore,
      index,
    };
  });

  // Rank highest-priority-first; ties preserve input order (stable).
  const ranking = scored
    .sort((a, b) => {
      if (b.score.priority !== a.score.priority) {
        return b.score.priority - a.score.priority;
      }
      return a.index - b.index;
    })
    .map(({ score }) => score);

  return { ranking, meta };
}
