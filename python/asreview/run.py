#!/usr/bin/env python3
"""ASReview active-learning re-ranking — stdin/stdout bridge.

Bridge: lib/engines/asreview.ts (rankRecords). Reads a JSON job on stdin
{"records": [{"id", "title", "abstract"}], "labeled": [{"id", "label": 0|1}]}
and emits exactly one JSON object on stdout:

  success: {"ok": true, "ranking": [{"id", "relevance": float}, ...]}   (unlabeled
           records only, most-relevant-first)
  handled error: {"ok": false, "error": "..."}  (exit 1)

Dep-gated: requires `asreview` (pip install asreview). When absent the script emits
an honest error envelope and exits 1 — never fake rankings. Trains a real
TF-IDF + Naive Bayes learner on the human decisions and scores the remaining
records. Record text is read from stdin only and is never logged.
"""
import json
import sys


def rank(job):
    records = job.get("records")
    labeled = job.get("labeled")
    if not isinstance(records, list) or not records:
        return {"ok": False, "error": "asreview: a non-empty 'records' array is required"}
    if not isinstance(labeled, list):
        return {"ok": False, "error": "asreview: a 'labeled' array is required"}

    label_by_id = {}
    for entry in labeled:
        if isinstance(entry, dict) and "id" in entry and entry.get("label") in (0, 1):
            label_by_id[entry["id"]] = int(entry["label"])

    if len(set(label_by_id.values())) < 2:
        return {
            "ok": False,
            "error": "asreview: need at least one relevant (1) and one irrelevant (0) label to train",
        }

    try:
        import numpy as np
        from asreview.models.classifiers import NaiveBayesClassifier
        from asreview.models.feature_extraction import Tfidf
    except ImportError:
        return {"ok": False, "error": "asreview not installed; install asreview to enable this engine"}

    texts = []
    for rec in records:
        title = rec.get("title") if isinstance(rec, dict) else None
        abstract = rec.get("abstract") if isinstance(rec, dict) else None
        texts.append(" ".join(part for part in (title, abstract) if isinstance(part, str)))

    feature_model = Tfidf()
    features = feature_model.fit_transform(texts)

    train_idx = [i for i, rec in enumerate(records)
                 if isinstance(rec, dict) and rec.get("id") in label_by_id]
    y_train = np.array([label_by_id[records[i]["id"]] for i in train_idx])

    classifier = NaiveBayesClassifier()
    classifier.fit(features[train_idx], y_train)

    unlabeled_idx = [i for i, rec in enumerate(records)
                     if not (isinstance(rec, dict) and rec.get("id") in label_by_id)]
    ranking = []
    if unlabeled_idx:
        proba = classifier.predict_proba(features[unlabeled_idx])
        # Column 1 is P(relevant); classes_ ordering is [0, 1] for the trained learner.
        relevant_col = 1 if proba.shape[1] > 1 else 0
        for pos, idx in enumerate(unlabeled_idx):
            ranking.append({
                "id": records[idx]["id"],
                "relevance": float(proba[pos, relevant_col]),
            })
        ranking.sort(key=lambda row: row["relevance"], reverse=True)

    return {"ok": True, "ranking": ranking}


def main():
    try:
        raw = sys.stdin.read()
        job = json.loads(raw) if raw.strip() else {}
        out = rank(job)
        print(json.dumps(out))
        return 0 if out.get("ok") else 1
    except Exception as exc:  # noqa: BLE001 — surface every failure as a JSON envelope
        print(json.dumps({"ok": False, "error": f"{type(exc).__name__}: {exc}"}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
