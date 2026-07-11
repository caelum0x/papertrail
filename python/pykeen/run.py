#!/usr/bin/env python3
"""PyKEEN knowledge-graph link prediction — stdin/stdout bridge.

Bridge: lib/engines/pykeen.ts (predictLinks). Reads a JSON job on stdin
{"triples": [[head, relation, tail], ...],
 "predict": {"head"?, "relation"?, "tail"?},   # leave exactly one slot out
 "model"?, "epochs"?, "top_k"?, "dimensions"?, "random_seed"?}
and emits exactly one JSON object on stdout:

  success: {"ok": true, "model", "epochs", "target",
            "predictions": [{"head", "relation", "tail", "score"}, ...]}
  handled error: {"ok": false, "error": "..."}  (exit 1)

Dep-gated: requires `pykeen` (pip install pykeen) and torch. When absent the script
emits an honest error envelope and exits 1 — never fake predictions. Trains a real
KGE model and scores candidate triples for the unspecified slot. The returned links
are HYPOTHESES to verify, not ground truth. Triples are read from stdin only, never
logged.
"""
import json
import sys

DEFAULT_MODEL = "TransE"
DEFAULT_EPOCHS = 5
MAX_EPOCHS = 200
DEFAULT_TOP_K = 10
DEFAULT_DIMENSIONS = 32


def _resolve_target(predict):
    """Return the slot name to predict (exactly one of head/relation/tail is missing)."""
    missing = [slot for slot in ("head", "relation", "tail")
               if predict.get(slot) in (None, "")]
    if len(missing) != 1:
        return None
    return missing[0]


def predict(job):
    triples = job.get("triples")
    predict_target_spec = job.get("predict")
    if not isinstance(triples, list) or not triples:
        return {"ok": False, "error": "pykeen: a non-empty 'triples' list is required"}
    if not isinstance(predict_target_spec, dict):
        return {"ok": False, "error": "pykeen: 'predict' target object is required"}

    clean_triples = []
    for row in triples:
        if isinstance(row, (list, tuple)) and len(row) == 3 and all(isinstance(x, str) for x in row):
            clean_triples.append((row[0], row[1], row[2]))
    if not clean_triples:
        return {"ok": False, "error": "pykeen: no valid [head, relation, tail] string triples"}

    target = _resolve_target(predict_target_spec)
    if target is None:
        return {"ok": False, "error": "pykeen: 'predict' must leave exactly one of head/relation/tail unset"}

    model_name = job.get("model") if isinstance(job.get("model"), str) else DEFAULT_MODEL
    epochs = job.get("epochs")
    epochs = epochs if isinstance(epochs, int) and epochs > 0 else DEFAULT_EPOCHS
    epochs = min(epochs, MAX_EPOCHS)
    top_k = job.get("top_k")
    top_k = top_k if isinstance(top_k, int) and top_k > 0 else DEFAULT_TOP_K
    dimensions = job.get("dimensions")
    dimensions = dimensions if isinstance(dimensions, int) and dimensions > 0 else DEFAULT_DIMENSIONS
    random_seed = job.get("random_seed")
    random_seed = random_seed if isinstance(random_seed, int) else 0

    try:
        import numpy as np
        from pykeen.pipeline import pipeline
        from pykeen.predict import predict_target
        from pykeen.triples import TriplesFactory
    except ImportError:
        return {"ok": False, "error": "pykeen not installed; install pykeen to enable this engine"}

    factory = TriplesFactory.from_labeled_triples(np.array(clean_triples, dtype=str))
    result = pipeline(
        training=factory,
        testing=factory,
        model=model_name,
        model_kwargs={"embedding_dim": dimensions},
        training_kwargs={"num_epochs": epochs, "use_tqdm": False},
        random_seed=random_seed,
    )

    fixed = {slot: predict_target_spec.get(slot) for slot in ("head", "relation", "tail")}
    kwargs = {slot: fixed[slot] for slot in ("head", "relation", "tail") if slot != target}
    prediction = predict_target(
        model=result.model,
        triples_factory=factory,
        **kwargs,
    )
    df = prediction.df

    label_col = f"{target}_label"
    predictions = []
    for _row_idx, row in df.head(top_k).iterrows():
        candidate = str(row[label_col])
        triple = {
            "head": fixed["head"],
            "relation": fixed["relation"],
            "tail": fixed["tail"],
        }
        triple[target] = candidate
        triple["score"] = float(row["score"])
        predictions.append(triple)

    return {
        "ok": True,
        "model": model_name,
        "epochs": epochs,
        "target": target,
        "predictions": predictions,
    }


def main():
    try:
        raw = sys.stdin.read()
        job = json.loads(raw) if raw.strip() else {}
        out = predict(job)
        print(json.dumps(out))
        return 0 if out.get("ok") else 1
    except Exception as exc:  # noqa: BLE001 — surface every failure as a JSON envelope
        print(json.dumps({"ok": False, "error": f"{type(exc).__name__}: {exc}"}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
