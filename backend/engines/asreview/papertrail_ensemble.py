#!/usr/bin/env python3
"""PaperTrail specialization of ASReview — a deterministic ENSEMBLE screener.

This file is a PaperTrail-native specialization of the ASReview engine (this repo
owns the vendored ASReview tree under backend/engines/asreview/). Upstream ASReview
screens systematic-review abstracts on ONE axis — relevant vs. irrelevant — with an
active-learning loop of TfidfVectorizer -> MultinomialNB -> Max query. PaperTrail's
reviewers need three judgements per abstract in a single pass:

  * INCLUDE / exclude        (is this study in scope?)
  * HIGH / low QUALITY       (is it methodologically sound?)
  * LOW / high RISK-OF-BIAS  (can we trust its effect estimate?)

So this module runs ASReview's exact deterministic core THREE times — one independent
TF-IDF + Multinomial Naive Bayes classifier per axis — over the same shared vocabulary,
then combines the three posteriors into ONE screening `priority` and records which axis
drove that priority (`deciding_axis`). The reviewer works the highest-priority abstracts
first, and the priority is honest about *why* an abstract rose to the top.

**No other file in this engine is modified.** This module is standalone Python with NO
third-party imports (no sklearn, no numpy, no ASReview install, no network), and this
whole directory is excluded from the Next build — zero TypeScript/build impact.

MOAT / reproducibility guarantees (identical to the TS mirror lib/screening/ensemble.ts):
  * TF-IDF fitted once over the union of labeled documents (sklearn-faithful:
    smooth_idf, use_idf, L2 row norm, token_pattern r"\\b\\w\\w+\\b", lowercased)
  * three independent MultinomialNB(alpha=1.0) heads, sharing that one vocabulary
  * the combined priority is deterministic rules-math over the three posteriors —
    NO LLM anywhere in any score, ranking, or deciding-axis decision
  * ranking ties preserve input order (stable), mirroring numpy argsort(kind="stable")

Claude never touches a posterior, a priority, or a ranking. Same labels + same
unlabeled pool -> same ranking, always.

USAGE (stdlib only, no install):

    # JSON on stdin: { "labeled": [...], "unlabeled": [...] }.
    #   labeled  item: {"text": str, "include": 0|1, "quality"?: 0|1, "rob"?: 0|1}
    #   unlabeled item: {"id": str, "text": str}
    echo '{"labeled":[{"text":"rct of drug x reduced events","include":1,"quality":1,"rob":0}],
           "unlabeled":[{"id":"a","text":"randomized trial of drug x"}]}' \
      | python3 papertrail_ensemble.py

    # or via --input-file
    python3 papertrail_ensemble.py --input-file batch.json

OUTPUT (stdout, JSON) — abstracts ranked most-important-first:

    {
      "ranking": [
        {"id": "a", "include_score": 0.91, "quality_score": 0.80,
         "rob_score": 0.20, "priority": 0.83, "deciding_axis": "include"},
        ...
      ],
      "meta": {"labeled": N, "unlabeled": M, "vocabulary_size": V,
               "axes_trained": ["include","quality","rob"]}
    }

The TypeScript mirror lib/screening/ensemble.ts consumes/produces exactly this shape,
field-for-field (see PAPERTRAIL.md for the mapping).
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
from typing import Dict, List, Optional, Tuple

# ---------------------------------------------------------------------------
# Constants — MUST stay identical to lib/screening/ensemble.ts (and, transitively,
# lib/screening/activeLearning.ts) so the Python screener and the on-demand TS
# screener rank an identical batch identically.
# ---------------------------------------------------------------------------

# sklearn CountVectorizer default token_pattern r"(?u)\b\w\w+\b" — runs of 2+ word
# chars, lowercased first. Unicode-aware so accented tokens survive.
_TOKEN_PATTERN = re.compile(r"[^\W_]{2,}", re.UNICODE)

# MultinomialNB default additive (Laplace/Lidstone) smoothing.
_NB_ALPHA = 1.0

# The three label axes, in the fixed order the combined priority weights them.
# Each axis maps a stored label (below) to the "priority-raising" posterior P(1):
#   include: P(include)      -> in scope
#   quality: P(high quality) -> methodologically sound
#   rob:     P(low RoB)      -> trustworthy (NOTE: the input `rob` is HIGH-RoB=1;
#                              we store LOW-RoB as the positive class, so a low-RoB
#                              abstract scores HIGH here — see _axis_positive.)
_AXES: Tuple[str, str, str] = ("include", "quality", "rob")

# Weights blending the three axis posteriors into one screening priority. Include
# dominates (scope is the gate); quality and low-RoB refine the ordering within scope.
_AXIS_WEIGHTS: Dict[str, float] = {"include": 0.5, "quality": 0.3, "rob": 0.2}


# ---------------------------------------------------------------------------
# Tokenisation + TF-IDF (sklearn-faithful; mirrors activeLearning.ts)
# ---------------------------------------------------------------------------


def tokenize(text: str) -> List[str]:
    """Tokenise one document exactly as ASReview's Tfidf (CountVectorizer) does."""
    return _TOKEN_PATTERN.findall(text.lower())


def fit_tfidf(documents: List[str]) -> Tuple[Dict[str, int], List[float]]:
    """Fit sklearn-faithful TF-IDF (smooth_idf, use_idf) over `documents`.

    Returns (vocabulary term->col, idf list aligned to cols). Vocabulary indices
    are assigned in sorted term order (deterministic). idf(t) = ln((1+n)/(1+df))+1.
    """
    n = len(documents)
    doc_freq: Dict[str, int] = {}
    for doc in documents:
        for term in set(tokenize(doc)):
            doc_freq[term] = doc_freq.get(term, 0) + 1

    vocabulary: Dict[str, int] = {}
    idf: List[float] = []
    for col, term in enumerate(sorted(doc_freq.keys())):
        vocabulary[term] = col
        df = doc_freq[term]
        idf.append(math.log((1 + n) / (1 + df)) + 1.0)
    return vocabulary, idf


def transform_tfidf(
    vocabulary: Dict[str, int], idf: List[float], document: str
) -> Dict[int, float]:
    """Transform one document into an L2-normalised TF-IDF sparse row (col->weight).

    Out-of-vocabulary tokens are dropped, exactly as sklearn does at transform time.
    """
    counts: Dict[int, float] = {}
    for term in tokenize(document):
        col = vocabulary.get(term)
        if col is None:
            continue
        counts[col] = counts.get(col, 0.0) + 1.0

    weighted: Dict[int, float] = {}
    sum_sq = 0.0
    for col, tf in counts.items():
        w = tf * idf[col]
        weighted[col] = w
        sum_sq += w * w

    if sum_sq == 0.0:
        return weighted  # empty / all-OOV document -> zero vector.

    norm = math.sqrt(sum_sq)
    return {col: w / norm for col, w in weighted.items()}


# ---------------------------------------------------------------------------
# Multinomial Naive Bayes (sklearn-faithful; mirrors activeLearning.ts)
# ---------------------------------------------------------------------------


def fit_naive_bayes(
    rows: List[Dict[int, float]], labels: List[int], n_features: int
) -> Optional[Tuple[Tuple[float, float], Tuple[List[float], List[float]]]]:
    """Fit binary MultinomialNB(alpha=1.0) over `rows`/`labels`.

    Returns ((log_prior0, log_prior1), (feature_log_prob0, feature_log_prob1)), or
    None when the axis has fewer than two labeled examples (nothing to fit) — the
    honest outcome is "this axis is untrained," not a fabricated classifier.
    """
    if len(rows) == 0 or len(rows) != len(labels):
        return None

    class_count = [0, 0]
    feature_count = [[0.0] * n_features, [0.0] * n_features]
    for row, c in zip(rows, labels):
        class_count[c] += 1
        for col, weight in row.items():
            feature_count[c][col] += weight

    total = class_count[0] + class_count[1]
    if total == 0:
        return None

    # fit_prior=True: class log-priors from observed frequencies. A class with zero
    # examples gets -inf (never predicted) — honest for a one-sided labeling.
    log_prior = (
        math.log(class_count[0] / total) if class_count[0] > 0 else -math.inf,
        math.log(class_count[1] / total) if class_count[1] > 0 else -math.inf,
    )

    feature_log_prob: Tuple[List[float], List[float]] = ([0.0] * n_features, [0.0] * n_features)
    for c in (0, 1):
        class_feature_sum = 0.0
        for col in range(n_features):
            class_feature_sum += feature_count[c][col]
        denom = class_feature_sum + _NB_ALPHA * n_features
        for col in range(n_features):
            feature_log_prob[c][col] = math.log(
                (feature_count[c][col] + _NB_ALPHA) / denom
            )
    return log_prior, feature_log_prob


def predict_positive(
    model: Tuple[Tuple[float, float], Tuple[List[float], List[float]]],
    row: Dict[int, float],
) -> float:
    """Predict P(class 1) for one row via a numerically stable two-class softmax.

    Mirrors sklearn predict_proba: joint log-lik per class = log_prior + Sum weight *
    feature_log_prob, softmaxed over the two classes.
    """
    log_prior, feature_log_prob = model
    joint = [log_prior[0], log_prior[1]]
    for c in (0, 1):
        if log_prior[c] == -math.inf:
            joint[c] = -math.inf
            continue
        acc = log_prior[c]
        logp = feature_log_prob[c]
        for col, weight in row.items():
            acc += weight * logp[col]
        joint[c] = acc

    if joint[1] == -math.inf:
        return 0.0
    if joint[0] == -math.inf:
        return 1.0
    m = max(joint[0], joint[1])
    e0 = math.exp(joint[0] - m)
    e1 = math.exp(joint[1] - m)
    return e1 / (e0 + e1)


# ---------------------------------------------------------------------------
# Ensemble: three axes -> combined priority + deciding axis
# ---------------------------------------------------------------------------


def _axis_positive(axis: str, label: Dict[str, int]) -> Optional[int]:
    """Map a labeled item to the 0/1 positive class for `axis`, or None if unlabeled
    on that axis.

    include: `include` (1 = in scope) is the positive class as-is.
    quality: `quality` (1 = high quality) is the positive class as-is.
    rob:     input `rob` is HIGH-RoB (1 = high risk). We want the positive class to be
             the GOOD outcome (low RoB), so we invert: positive = 1 - rob. A low-RoB
             abstract then scores HIGH on this axis, consistent with include/quality.
    """
    if axis == "include":
        v = label.get("include")
        return v if v in (0, 1) else None
    if axis == "quality":
        v = label.get("quality")
        return v if v in (0, 1) else None
    # rob
    v = label.get("rob")
    if v not in (0, 1):
        return None
    return 1 - v


def _decide_priority(scores: Dict[str, float]) -> Tuple[float, str]:
    """Combine per-axis positive-class posteriors into one screening priority and the
    deciding axis.

    THE BOUNDARY (documented in PAPERTRAIL.md): priority is the fixed weighted mean
    Sum_axis weight[axis] * score[axis] over the axes that were actually trained,
    renormalised by the sum of the used weights so an untrained axis neither helps nor
    hurts. The `deciding_axis` is the axis contributing the largest weighted term
    weight[axis]*score[axis] — i.e. the axis that pushed this abstract up the ranking.
    Ties break by the fixed axis order (include > quality > rob).
    """
    weighted_terms: List[Tuple[str, float]] = []
    weight_sum = 0.0
    for axis in _AXES:
        if axis not in scores:
            continue
        w = _AXIS_WEIGHTS[axis]
        weighted_terms.append((axis, w * scores[axis]))
        weight_sum += w

    if not weighted_terms or weight_sum == 0.0:
        return 0.0, "none"

    priority = sum(term for _, term in weighted_terms) / weight_sum

    deciding_axis = weighted_terms[0][0]
    best_term = weighted_terms[0][1]
    for axis, term in weighted_terms[1:]:
        if term > best_term:
            best_term = term
            deciding_axis = axis
    return priority, deciding_axis


def ensemble_screen(
    labeled: List[Dict[str, object]], unlabeled: List[Dict[str, object]]
) -> Dict[str, object]:
    """Run the three-axis ensemble screen and rank the unlabeled abstracts.

    Steps:
      1. Fit ONE TF-IDF over all labeled documents (shared vocabulary).
      2. For each axis, fit a MultinomialNB over the labeled rows that carry a label
         on that axis (axes with <2 usable labels are skipped — honestly untrained).
      3. Score every unlabeled abstract's positive-class posterior on each trained axis.
      4. Combine into a priority + deciding axis, and rank most-important-first (stable).

    Degenerate inputs are handled honestly: no labeled/unlabeled records, or a labeled
    set with no usable tokens, yields an empty ranking rather than a fabricated one.
    """
    labeled_docs = [str(item.get("text") or "") for item in labeled]
    axes_trained: List[str] = []

    base_meta: Dict[str, object] = {
        "labeled": len(labeled),
        "unlabeled": len(unlabeled),
        "vocabulary_size": 0,
        "axes_trained": axes_trained,
    }

    if len(labeled) == 0 or len(unlabeled) == 0:
        return {"ranking": [], "meta": base_meta}

    vocabulary, idf = fit_tfidf(labeled_docs)
    n_features = len(vocabulary)
    base_meta["vocabulary_size"] = n_features

    if n_features == 0:
        return {"ranking": [], "meta": base_meta}

    labeled_rows = [transform_tfidf(vocabulary, idf, doc) for doc in labeled_docs]

    # One NB head per axis, over the subset of labeled rows carrying that axis label.
    models: Dict[
        str, Tuple[Tuple[float, float], Tuple[List[float], List[float]]]
    ] = {}
    for axis in _AXES:
        axis_rows: List[Dict[int, float]] = []
        axis_labels: List[int] = []
        for row, item in zip(labeled_rows, labeled):
            pos = _axis_positive(axis, item)  # type: ignore[arg-type]
            if pos is None:
                continue
            axis_rows.append(row)
            axis_labels.append(pos)
        # Need at least one example of BOTH classes to fit a discriminative head.
        if len(set(axis_labels)) < 2:
            continue
        model = fit_naive_bayes(axis_rows, axis_labels, n_features)
        if model is None:
            continue
        models[axis] = model
        axes_trained.append(axis)

    if not models:
        # Nothing discriminative to score on -> honest empty ranking.
        return {"ranking": [], "meta": base_meta}

    scored: List[Dict[str, object]] = []
    for index, item in enumerate(unlabeled):
        rid = str(item.get("id") or "")
        row = transform_tfidf(vocabulary, idf, str(item.get("text") or ""))
        scores: Dict[str, float] = {}
        for axis, model in models.items():
            scores[axis] = predict_positive(model, row)
        priority, deciding_axis = _decide_priority(scores)
        scored.append(
            {
                "id": rid,
                "include_score": scores.get("include", 0.0),
                "quality_score": scores.get("quality", 0.0),
                "rob_score": scores.get("rob", 0.0),
                "priority": priority,
                "deciding_axis": deciding_axis,
                "_index": index,
            }
        )

    # Rank most-important-first; ties preserve input order (stable).
    scored.sort(key=lambda s: (-float(s["priority"]), int(s["_index"])))
    ranking = [
        {k: v for k, v in s.items() if k != "_index"} for s in scored
    ]

    return {"ranking": ranking, "meta": base_meta}


# ---------------------------------------------------------------------------
# Input parsing + CLI
# ---------------------------------------------------------------------------


def _parse_input(raw: object) -> Tuple[List[Dict[str, object]], List[Dict[str, object]]]:
    """Validate + normalize the input batch.

    Expects {"labeled": [...], "unlabeled": [...]}. Malformed labeled/unlabeled items
    are DROPPED (never coerced): a labeled item needs a non-empty `text` and an
    `include` in {0,1}; an unlabeled item needs a non-empty `id` and `text`. Optional
    `quality`/`rob` are kept only when in {0,1}.
    """
    if not isinstance(raw, dict):
        raise ValueError("input must be a JSON object with 'labeled' and 'unlabeled'")

    raw_labeled = raw.get("labeled")
    raw_unlabeled = raw.get("unlabeled")
    if not isinstance(raw_labeled, list) or not isinstance(raw_unlabeled, list):
        raise ValueError("'labeled' and 'unlabeled' must both be JSON arrays")

    labeled: List[Dict[str, object]] = []
    for item in raw_labeled:
        if not isinstance(item, dict):
            continue
        text = item.get("text")
        include = item.get("include")
        if not isinstance(text, str) or not text.strip():
            continue
        if include not in (0, 1):
            continue
        record: Dict[str, object] = {"text": text, "include": include}
        quality = item.get("quality")
        if quality in (0, 1):
            record["quality"] = quality
        rob = item.get("rob")
        if rob in (0, 1):
            record["rob"] = rob
        labeled.append(record)

    unlabeled: List[Dict[str, object]] = []
    for item in raw_unlabeled:
        if not isinstance(item, dict):
            continue
        rid = item.get("id")
        text = item.get("text")
        if not isinstance(rid, str) or not rid.strip():
            continue
        if not isinstance(text, str) or not text.strip():
            continue
        unlabeled.append({"id": rid, "text": text})

    return labeled, unlabeled


def main(argv: List[str]) -> int:
    parser = argparse.ArgumentParser(
        description="Deterministic three-axis ensemble abstract screener (PaperTrail/ASReview)."
    )
    parser.add_argument(
        "--input-file",
        help="Path to a JSON file {labeled, unlabeled}; if omitted, read JSON from stdin.",
    )
    args = parser.parse_args(argv)

    try:
        if args.input_file:
            with open(args.input_file, "r", encoding="utf-8") as handle:
                raw = json.load(handle)
        else:
            raw = json.load(sys.stdin)
    except (OSError, json.JSONDecodeError) as exc:
        json.dump({"error": f"could not read input: {exc}"}, sys.stdout)
        sys.stdout.write("\n")
        return 2

    try:
        labeled, unlabeled = _parse_input(raw)
    except ValueError as exc:
        json.dump({"error": str(exc)}, sys.stdout)
        sys.stdout.write("\n")
        return 2

    result = ensemble_screen(labeled, unlabeled)
    json.dump(result, sys.stdout)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
