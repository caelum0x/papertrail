// Native TypeScript port of the ASReview (Apache-2.0) active-learning screening core.
//
// ASReview's default model for systematic-review title/abstract screening is a
// pipeline of three deterministic components:
//   feature_extractor = Tfidf   (sklearn TfidfVectorizer over title+abstract)
//   classifier        = NaiveBayes (sklearn MultinomialNB, alpha=1.0)
//   querier           = Max      (rank by predicted P(relevant), descending)
//
// This module ports that EXACT loop into pure, immutable TypeScript math — no
// Python, no subprocess, no trained model file. Given a set of records and a
// handful of human include/exclude labels, it fits TF-IDF + Naive Bayes on the
// labeled records, predicts P(relevant) for every unlabeled record, and returns
// them ranked most-relevant-first (the Max query strategy). This is the real
// ASReview relevance-feedback triage: the reviewer screens the highest-value
// records first, cutting the manual burden of title/abstract screening.
//
// Faithful to sklearn's defaults so a ported ranking matches the original engine:
//   - token_pattern  r"\b\w\w+\b" (2+ word chars), lowercased
//   - TF-IDF: raw term counts, smooth_idf=True → idf = ln((1+n)/(1+df)) + 1,
//     use_idf=True, sublinear_tf=False, L2 row normalisation
//   - MultinomialNB: additive (Laplace) smoothing alpha=1.0, class log-priors
//     from labeled class frequencies, multinomial feature log-likelihoods
//
// Pure functions, no mutation, explicit errors. No Claude needed — the entire
// ranking is deterministic math (same inputs → same ranking, always).

// --- Public contract -------------------------------------------------------

/** A candidate record to screen. `abstract` may be empty (title-only records). */
export interface ALRecord {
  id: string;
  title: string;
  abstract: string;
}

/** A prior human decision: label01 = 1 (relevant/include) or 0 (irrelevant/exclude). */
export interface ALLabel {
  id: string;
  label01: 0 | 1;
}

/** One ranked unlabeled record; higher relevance = more likely to be relevant. */
export interface ALRankedRecord {
  id: string;
  /** Predicted P(relevant) in [0, 1] from the fitted Naive Bayes model. */
  relevance: number;
}

export interface ALRankResult {
  /** Unlabeled records, most-relevant-first (ASReview's Max query strategy). */
  ranking: ALRankedRecord[];
  /** Diagnostic counts — no record text, safe to log. */
  meta: {
    labeled: number;
    relevantLabels: number;
    irrelevantLabels: number;
    unlabeled: number;
    vocabularySize: number;
  };
}

// --- Tokenisation ----------------------------------------------------------

// sklearn CountVectorizer default token_pattern: r"(?u)\b\w\w+\b" — runs of two
// or more "word" characters. We lowercase first (lowercase=True default). Unicode
// word chars are matched via the `u` flag so accented tokens survive.
const TOKEN_PATTERN = /[\p{L}\p{N}_]{2,}/gu;

/** Tokenise one record's merged title+abstract exactly as ASReview's TextMerger + Tfidf does. */
export function tokenize(text: string): string[] {
  const matches = text.toLowerCase().match(TOKEN_PATTERN);
  return matches ? [...matches] : [];
}

/** Merge title + abstract with a single space, matching ASReview's TextMerger(sep=" "). */
function recordText(record: ALRecord): string {
  const title = record.title ?? "";
  const abstract = record.abstract ?? "";
  return `${title} ${abstract}`.trim();
}

// --- TF-IDF vectoriser (sklearn-faithful) ----------------------------------

/**
 * A fitted TF-IDF vocabulary + inverse-document-frequency vector, learned from a
 * set of documents (the labeled records). Immutable once built.
 */
export interface TfidfModel {
  /** term -> column index. */
  vocabulary: ReadonlyMap<string, number>;
  /** idf[col], aligned with vocabulary indices. */
  idf: readonly number[];
}

/** A sparse row: column index -> weight. */
export type SparseRow = ReadonlyMap<number, number>;

/**
 * Fit a TF-IDF model on the given documents, replicating sklearn's TfidfVectorizer
 * defaults (smooth_idf=True, use_idf=True, sublinear_tf=False). The vocabulary is
 * every distinct token appearing in the fit documents (min_df=1, max_df=1.0).
 *
 * idf(t) = ln((1 + n) / (1 + df(t))) + 1, where n = number of fit documents and
 * df(t) = number of fit documents containing t. Pure — does not mutate inputs.
 */
export function fitTfidf(documents: readonly string[]): TfidfModel {
  const n = documents.length;
  const docFreq = new Map<string, number>();

  for (const doc of documents) {
    // Distinct terms per document drive document frequency.
    const seen = new Set(tokenize(doc));
    for (const term of seen) {
      docFreq.set(term, (docFreq.get(term) ?? 0) + 1);
    }
  }

  // sklearn assigns vocabulary indices in sorted term order (deterministic).
  const terms = [...docFreq.keys()].sort();
  const vocabulary = new Map<string, number>();
  const idf: number[] = [];
  terms.forEach((term, col) => {
    vocabulary.set(term, col);
    const df = docFreq.get(term) ?? 0;
    idf.push(Math.log((1 + n) / (1 + df)) + 1);
  });

  return { vocabulary, idf };
}

/**
 * Transform one document into its L2-normalised TF-IDF sparse row using a fitted
 * model. Out-of-vocabulary tokens are dropped (as sklearn does at transform time).
 * Matches sklearn: tf = raw count, weighted by idf, then the row is L2-normalised.
 */
export function transformTfidf(model: TfidfModel, document: string): SparseRow {
  const counts = new Map<number, number>();
  for (const term of tokenize(document)) {
    const col = model.vocabulary.get(term);
    if (col === undefined) continue;
    counts.set(col, (counts.get(col) ?? 0) + 1);
  }

  // Apply idf weighting: weight = tf * idf.
  const weighted = new Map<number, number>();
  let sumSq = 0;
  for (const [col, tf] of counts) {
    const w = tf * model.idf[col];
    weighted.set(col, w);
    sumSq += w * w;
  }

  if (sumSq === 0) {
    return weighted; // all-OOV or empty document → zero vector (no normalisation).
  }

  const norm = Math.sqrt(sumSq);
  const normalised = new Map<number, number>();
  for (const [col, w] of weighted) {
    normalised.set(col, w / norm);
  }
  return normalised;
}

// --- Multinomial Naive Bayes (sklearn-faithful) ----------------------------

/** Additive (Laplace/Lidstone) smoothing prior — sklearn MultinomialNB default alpha. */
const NB_ALPHA = 1.0;

/**
 * A fitted binary Multinomial Naive Bayes model over the two screening classes
 * (0 = irrelevant, 1 = relevant). Stores per-class log-priors and per-feature
 * log-probabilities, exactly as sklearn's MultinomialNB does after fit().
 */
export interface NaiveBayesModel {
  /** Number of feature columns (vocabulary size). */
  nFeatures: number;
  /** classLogPrior[c] = ln( count(class c) / total ). */
  classLogPrior: readonly [number, number];
  /** featureLogProb[c][col] = ln( (Nc,col + alpha) / (Nc + alpha*nFeatures) ). */
  featureLogProb: readonly [readonly number[], readonly number[]];
}

/**
 * Fit MultinomialNB on labeled feature rows, replicating sklearn's estimator with
 * alpha=1.0. `rows` and `labels` must be aligned. Each feature column's smoothed
 * conditional probability is the class-summed feature weight plus alpha over the
 * class total plus alpha*nFeatures. Pure — allocates fresh arrays, mutates nothing.
 *
 * Throws if there are no labeled rows (nothing to learn from) — an explicit error
 * the caller surfaces rather than returning a meaningless model.
 */
export function fitNaiveBayes(
  rows: readonly SparseRow[],
  labels: readonly (0 | 1)[],
  nFeatures: number
): NaiveBayesModel {
  if (rows.length === 0) {
    throw new Error("Cannot fit Naive Bayes: no labeled records were provided.");
  }
  if (rows.length !== labels.length) {
    throw new Error("Cannot fit Naive Bayes: rows and labels are misaligned.");
  }

  const classCount: [number, number] = [0, 0];
  // Per-class summed feature weights (feature_count_ in sklearn), size nFeatures.
  const featureCount: [number[], number[]] = [
    new Array<number>(nFeatures).fill(0),
    new Array<number>(nFeatures).fill(0),
  ];

  rows.forEach((row, i) => {
    const c = labels[i];
    classCount[c] += 1;
    for (const [col, weight] of row) {
      featureCount[c][col] += weight;
    }
  });

  const total = classCount[0] + classCount[1];
  // Class log-prior from observed label frequencies (fit_prior=True default).
  // A class with zero labeled examples gets -Infinity prior → never predicted,
  // which is the honest outcome when the reviewer has only labeled one side.
  const classLogPrior: [number, number] = [
    classCount[0] > 0 ? Math.log(classCount[0] / total) : -Infinity,
    classCount[1] > 0 ? Math.log(classCount[1] / total) : -Infinity,
  ];

  const featureLogProb: [number[], number[]] = [
    new Array<number>(nFeatures).fill(0),
    new Array<number>(nFeatures).fill(0),
  ];
  for (const c of [0, 1] as const) {
    // smoothed_cc = sum over features of (Nc,col + alpha) = Nc_total + alpha*nFeatures.
    let classFeatureSum = 0;
    for (let col = 0; col < nFeatures; col++) {
      classFeatureSum += featureCount[c][col];
    }
    const denom = classFeatureSum + NB_ALPHA * nFeatures;
    for (let col = 0; col < nFeatures; col++) {
      featureLogProb[c][col] = Math.log(
        (featureCount[c][col] + NB_ALPHA) / denom
      );
    }
  }

  return { nFeatures, classLogPrior, featureLogProb };
}

/**
 * Predict P(relevant) for one feature row from a fitted NB model. Computes the
 * joint log-likelihood per class (log-prior + Σ weight·featureLogProb) and returns
 * the normalised posterior for the relevant class (1) via a numerically stable
 * softmax, matching sklearn's predict_proba. Pure.
 */
export function predictRelevance(model: NaiveBayesModel, row: SparseRow): number {
  const jointLogLik: [number, number] = [
    model.classLogPrior[0],
    model.classLogPrior[1],
  ];
  for (const c of [0, 1] as const) {
    let acc = model.classLogPrior[c];
    if (acc === -Infinity) {
      jointLogLik[c] = -Infinity;
      continue;
    }
    const logProb = model.featureLogProb[c];
    for (const [col, weight] of row) {
      acc += weight * logProb[col];
    }
    jointLogLik[c] = acc;
  }

  // Numerically stable softmax over the two classes → P(class 1 | row).
  if (jointLogLik[1] === -Infinity) return 0;
  if (jointLogLik[0] === -Infinity) return 1;
  const max = Math.max(jointLogLik[0], jointLogLik[1]);
  const e0 = Math.exp(jointLogLik[0] - max);
  const e1 = Math.exp(jointLogLik[1] - max);
  return e1 / (e0 + e1);
}

// --- Max query strategy + full active-learning loop ------------------------

/**
 * ASReview's Max querier: order records by predicted relevance descending. Ties
 * preserve input order (stable), mirroring numpy's `argsort(-p, kind="stable")`.
 * Pure — returns a new array, does not mutate the input.
 */
export function maxQuery(scored: readonly ALRankedRecord[]): ALRankedRecord[] {
  return scored
    .map((r, i) => ({ r, i }))
    .sort((a, b) => {
      if (b.r.relevance !== a.r.relevance) return b.r.relevance - a.r.relevance;
      return a.i - b.i; // stable: earlier input wins on a tie.
    })
    .map(({ r }) => r);
}

/**
 * The full ASReview active-learning screening cycle, natively in TS:
 *   1. Fit TF-IDF on the labeled records' title+abstract.
 *   2. Fit MultinomialNB on those TF-IDF rows against their 0/1 labels.
 *   3. Score every UNLABELED record's P(relevant).
 *   4. Rank most-relevant-first (Max query strategy).
 *
 * `records` is the full candidate pool; `labeled` are prior human decisions on a
 * subset. Records without a label are the ones ranked (the reviewer's worklist).
 *
 * Degenerate inputs are handled honestly rather than fabricating a ranking:
 *   - No labeled records, or no unlabeled records → empty ranking.
 *   - Labels covering only one class → NB predicts that single class; the ranking
 *     still returns (every unlabeled record scored against the one-sided prior).
 *
 * Pure orchestration: no DB, no network, no mutation of inputs.
 */
export function rankRecordsAL(
  records: readonly ALRecord[],
  labeled: readonly ALLabel[]
): ALRankResult {
  const labelById = new Map<string, 0 | 1>();
  for (const l of labeled) {
    // Last write wins if a record is labeled twice; only records present in the
    // pool count (a stray label id can't train on text we don't have).
    labelById.set(l.id, l.label01);
  }

  const labeledRecords: { record: ALRecord; label: 0 | 1 }[] = [];
  const unlabeledRecords: ALRecord[] = [];
  for (const record of records) {
    const label = labelById.get(record.id);
    if (label === undefined) {
      unlabeledRecords.push(record);
    } else {
      labeledRecords.push({ record, label });
    }
  }

  const relevantLabels = labeledRecords.filter((l) => l.label === 1).length;
  const irrelevantLabels = labeledRecords.length - relevantLabels;

  const baseMeta = {
    labeled: labeledRecords.length,
    relevantLabels,
    irrelevantLabels,
    unlabeled: unlabeledRecords.length,
  };

  // Nothing to learn from, or nothing to rank → honest empty ranking.
  if (labeledRecords.length === 0 || unlabeledRecords.length === 0) {
    return { ranking: [], meta: { ...baseMeta, vocabularySize: 0 } };
  }

  // 1. TF-IDF fitted on the labeled documents (the model's known vocabulary).
  const tfidf = fitTfidf(labeledRecords.map((l) => recordText(l.record)));
  const nFeatures = tfidf.vocabulary.size;

  // A labeled set with no usable tokens (all empty text) can't train a classifier;
  // return the unlabeled records at zero relevance rather than dividing by zero.
  if (nFeatures === 0) {
    const ranking = maxQuery(
      unlabeledRecords.map((r) => ({ id: r.id, relevance: 0 }))
    );
    return { ranking, meta: { ...baseMeta, vocabularySize: 0 } };
  }

  const labeledRows = labeledRecords.map((l) =>
    transformTfidf(tfidf, recordText(l.record))
  );

  // 2. MultinomialNB on the labeled TF-IDF rows.
  const nb = fitNaiveBayes(
    labeledRows,
    labeledRecords.map((l) => l.label),
    nFeatures
  );

  // 3. Score every unlabeled record against the fitted model.
  const scored: ALRankedRecord[] = unlabeledRecords.map((record) => {
    const row = transformTfidf(tfidf, recordText(record));
    return { id: record.id, relevance: predictRelevance(nb, row) };
  });

  // 4. Max query strategy: most-relevant-first.
  const ranking = maxQuery(scored);

  return { ranking, meta: { ...baseMeta, vocabularySize: nFeatures } };
}
