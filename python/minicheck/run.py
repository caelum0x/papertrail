#!/usr/bin/env python3
"""MiniCheck claim-entailment fact-checking — stdin/stdout bridge.

Bridge: lib/engines/minicheck.ts (factCheck). Reads a JSON job on stdin
{"pairs": [{"claim": str, "doc": str}, ...]} and emits exactly one JSON object
on stdout:

  success: {"ok": true, "results": [
      {"claim", "supported": bool, "score": float /* P(supported), 0..1 */}, ...]}
  handled error: {"ok": false, "error": "..."}  (exit 1)

Dep-gated: needs the `transformers` stack plus the MiniCheck model wrapper
(`minicheck`). When either is absent the script emits an honest error envelope and
exits 1 — never a fake verdict. Runs the real MiniCheck scorer (default model
flan-t5-large, override with MINICHECK_MODEL), which returns the support
probability of the decisive chunk per (claim, doc) pair. Claim/doc text is read
from stdin only and is never logged.
"""
import json
import os
import sys

DEFAULT_MODEL = "flan-t5-large"


def fact_check(job):
    pairs = job.get("pairs")
    if not isinstance(pairs, list) or not pairs:
        return {"ok": False, "error": "minicheck: a non-empty 'pairs' array is required"}

    claims = []
    docs = []
    for pair in pairs:
        if not isinstance(pair, dict) or not isinstance(pair.get("claim"), str) or not isinstance(pair.get("doc"), str):
            return {"ok": False, "error": "minicheck: each pair needs string 'claim' and 'doc'"}
        claims.append(pair["claim"])
        docs.append(pair["doc"])

    # transformers is the heavy runtime dependency the MiniCheck model runs on.
    try:
        import transformers  # noqa: F401
    except ImportError:
        return {"ok": False, "error": "transformers not installed; install transformers to enable this engine"}

    # The MiniCheck wrapper implements the decisive-chunk scoring the bridge expects.
    try:
        from minicheck.minicheck import MiniCheck
    except ImportError:
        return {"ok": False, "error": "minicheck not installed; install minicheck to enable this engine"}

    model_name = os.environ.get("MINICHECK_MODEL", DEFAULT_MODEL)
    scorer = MiniCheck(model_name=model_name)
    pred_labels, raw_prob_scores, _, _ = scorer.score(docs=docs, claims=claims)

    results = []
    for claim, label, score in zip(claims, pred_labels, raw_prob_scores):
        results.append({
            "claim": claim,
            "supported": bool(int(label) == 1),
            "score": float(score),
        })

    return {"ok": True, "results": results}


def main():
    try:
        raw = sys.stdin.read()
        job = json.loads(raw) if raw.strip() else {}
        out = fact_check(job)
        print(json.dumps(out))
        return 0 if out.get("ok") else 1
    except Exception as exc:  # noqa: BLE001 — surface every failure as a JSON envelope
        print(json.dumps({"ok": False, "error": f"{type(exc).__name__}: {exc}"}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
