#!/usr/bin/env python3
"""PyMARE meta-analysis cross-check — stdin/stdout bridge.

Bridge: lib/engines/pymare.ts (pooledPyMARE). Reads a JSON job on stdin
{"yi": [float], "vi": [float]} and emits exactly one JSON object on stdout:

  success: {"ok": true,
            "fixed":  {"estimate", "se", "ciLower", "ciUpper"},
            "random": {"estimate", "se", "ciLower", "ciUpper", "tau2"},
            "q":  float,   # Cochran's Q
            "i2": float}   # I^2 heterogeneity, 0..100
  handled error: {"ok": false, "error": "..."}  (exit 1)

Dep-gated: requires `pymare` (pip install pymare) and numpy. When the library is
absent the script emits an honest error envelope and exits 1 — never fake numbers.
Runs a real fixed-effect (WeightedLeastSquares) and random-effects (DerSimonian-
Laird) pooling; Q and I^2 are the standard closed-form heterogeneity statistics.
The input values are read from stdin only and are never logged.
"""
import json
import sys


def _scalar(value):
    import numpy as np

    return float(np.asarray(value).ravel()[0])


def _pooled(fe_stats):
    """Map a PyMARE get_fe_stats() dict to the bridge's pooled shape."""
    return {
        "estimate": _scalar(fe_stats["est"]),
        "se": _scalar(fe_stats["se"]),
        "ciLower": _scalar(fe_stats["ci_l"]),
        "ciUpper": _scalar(fe_stats["ci_u"]),
    }


def _cochran_q_i2(yi, vi):
    """Closed-form Cochran's Q and I^2 (percent) from study effects/variances."""
    import numpy as np

    y = np.asarray(yi, dtype=float)
    v = np.asarray(vi, dtype=float)
    w = 1.0 / v
    weighted_mean = float(np.sum(w * y) / np.sum(w))
    q = float(np.sum(w * (y - weighted_mean) ** 2))
    df = len(y) - 1
    if q > 0 and df > 0:
        i2 = max(0.0, (q - df) / q) * 100.0
    else:
        i2 = 0.0
    return q, i2


def compute(job):
    yi = job.get("yi")
    vi = job.get("vi")
    if not isinstance(yi, list) or not isinstance(vi, list):
        return {"ok": False, "error": "pymare: 'yi' and 'vi' must both be arrays"}
    if len(yi) == 0 or len(yi) != len(vi):
        return {"ok": False, "error": "pymare: 'yi' and 'vi' must be non-empty and equal length"}
    if any(not isinstance(x, (int, float)) for x in yi + vi):
        return {"ok": False, "error": "pymare: 'yi' and 'vi' must contain only numbers"}
    if any(float(x) <= 0 for x in vi):
        return {"ok": False, "error": "pymare: all sampling variances 'vi' must be positive"}

    try:
        import numpy as np
        from pymare import Dataset
        from pymare.estimators import DerSimonianLaird, WeightedLeastSquares
    except ImportError:
        return {"ok": False, "error": "pymare not installed; install pymare to enable this engine"}

    y = np.asarray(yi, dtype=float).reshape(-1, 1)
    v = np.asarray(vi, dtype=float).reshape(-1, 1)
    dataset = Dataset(y=y, v=v)

    fe_result = WeightedLeastSquares().fit_dataset(dataset).summary()
    re_result = DerSimonianLaird().fit_dataset(dataset).summary()

    fixed = _pooled(fe_result.get_fe_stats())
    random = _pooled(re_result.get_fe_stats())

    try:
        tau2 = _scalar(re_result.get_re_stats()["tau^2"])
    except Exception:  # noqa: BLE001 — fall back to the attribute across pymare versions
        tau2 = _scalar(getattr(re_result, "tau2", 0.0))
    random["tau2"] = tau2

    q, i2 = _cochran_q_i2(yi, vi)

    return {"ok": True, "fixed": fixed, "random": random, "q": q, "i2": i2}


def main():
    try:
        raw = sys.stdin.read()
        job = json.loads(raw) if raw.strip() else {}
        out = compute(job)
        print(json.dumps(out))
        return 0 if out.get("ok") else 1
    except Exception as exc:  # noqa: BLE001 — surface every failure as a JSON envelope
        print(json.dumps({"ok": False, "error": f"{type(exc).__name__}: {exc}"}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
