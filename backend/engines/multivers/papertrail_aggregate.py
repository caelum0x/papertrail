#!/usr/bin/env python3
# PAPERTRAIL-NATIVE CROSS-SOURCE LABEL AGGREGATOR — a specialization of the MultiVerS
# engine, owned by PaperTrail (this repo). See PAPERTRAIL.md in this directory.
#
# WHY THIS FILE EXISTS
# --------------------
# MultiVerS (multivers/model.py::decode, label_lookup {0:CONTRADICT, 1:NEI, 2:SUPPORT})
# scores ONE {claim, abstract} pair at a time: it emits a single SUPPORTS / REFUTES(=
# CONTRADICT) / NEI label + the rationale sentences of THAT abstract. predict.py runs the
# model per (claim, abstract) row and writes one label PER abstract. What MultiVerS never
# does is COMBINE the per-abstract labels for the SAME claim into a claim-level verdict —
# there is no cross-source aggregation step in the shipped pipeline. Downstream code is left
# to decide "given SUPPORTS from paper A, REFUTES from paper B, NEI from paper C, what does
# the body of evidence say?".
#
# PaperTrail's contradiction atlas needs exactly that AGGREGATE verdict. PaperTrail's MOAT
# rule is: NO LLM in the verdict / numeric / ranking path. So this file ports the missing
# cross-source aggregation step DETERMINISTICALLY: given the per-source {label, confidence}
# already produced upstream (by the TS lib/scieval MultiVerS port, one label per abstract),
# it computes a confidence-weighted tally over the MultiVerS label taxonomy and classifies
# the claim into supported / refuted / mixed / insufficient, with the tally + net direction.
#
# This is the Python mirror of the TypeScript contract in lib/scieval/crossSourceAggregate.ts.
# It is the deterministic cross-check for the hot-path TS implementation (prefer native TS on
# hot paths with the Python engine as a by-hand cross-check). No other file in this engine is
# modified.
#
# CONTRACT (mirrors lib/scieval/crossSourceAggregate.ts)
# ------------------------------------------------------
#   * Deterministic: no model calls, no network. Same input -> same output, always.
#   * Label vocabulary is MultiVerS's own: SUPPORTS / REFUTES / NEI (label_lookup in
#     multivers/model.py). SUPPORTS is class SUPPORT(2), REFUTES is CONTRADICT(0), NEI is
#     class NEI(1). Any other label is rejected as bad input.
#   * Each source contributes its `confidence` (default 1.0 if omitted, clamped to [0,1]) to
#     its label's weighted tally. NEI contributes to the NEI mass only — it never nudges the
#     support/refute direction (a "not enough info" abstract makes no directional claim).
#   * Verdict is decided by the net directional mass and the share of directional evidence:
#       - no directional mass at all (only NEI, or no sources)     -> "insufficient"
#       - directional mass present, one side clearly dominates      -> "supported" / "refuted"
#       - directional mass present but neither side dominates       -> "mixed"
#   * Honest abstention: an all-NEI or empty body of evidence is "insufficient", never a
#     forced directional verdict. Mirrors PaperTrail's "honest insufficient over a forced
#     answer" rule and MultiVerS's own NEI class.
#
# I/O (argparse):
#   JSON on stdin, or --json '{...}':
#     { "sources": [ { "id": str, "label": "SUPPORTS"|"REFUTES"|"NEI", "confidence"? float } ] }
#   Prints ONE JSON object to stdout mirroring CrossSourceAggregate:
#     { "verdict", "supportCount", "refuteCount", "neiCount", "netConfidence", "mixed",
#       "tally": {...}, "netDirection", "consideredCount" }
#   On invalid input prints {"error": "..."} to stdout and exits 2.
#
# Standalone: `python papertrail_aggregate.py --json '{...}'`. Imports only the Python
# standard library (no MultiVerS install, no torch, no network, no model download). This
# directory is excluded from the Next build, so there is zero TypeScript impact.

import argparse
import json
import sys
from typing import Dict, List, Tuple

# MultiVerS label taxonomy (multivers/model.py::decode, label_lookup {0:CONTRADICT,1:NEI,
# 2:SUPPORT}), kept under the SciFact-facing names data.py uses. This is the exact vocabulary
# lib/scieval/schemas.ts::ScievalLabel exposes to the TS port; we reuse it, never redefine it.
SUPPORTS = "SUPPORTS"
REFUTES = "REFUTES"
NEI = "NEI"
VALID_LABELS: Tuple[str, ...] = (SUPPORTS, REFUTES, NEI)

# Deterministic tuning constants — FIXED, documented, identical to
# lib/scieval/crossSourceAggregate.ts so the Python cross-check and the TS hot path produce
# the same verdict by hand.
#
# DEFAULT_CONFIDENCE: a source with no confidence counts as a full-strength vote.
DEFAULT_CONFIDENCE = 1.0
# DOMINANCE_THRESHOLD: the fraction of the directional (SUPPORTS+REFUTES) mass one side must
# hold to win outright. Below it, the two sides are treated as genuinely conflicting -> mixed.
DOMINANCE_THRESHOLD = 0.7


def _clamp(value: float, lo: float, hi: float) -> float:
    return min(hi, max(lo, value))


def _confidence_of(source: dict) -> float:
    """Read a source's confidence, defaulting to DEFAULT_CONFIDENCE and clamping to [0,1].

    Raises ValueError if a supplied confidence is not a finite number so bad input is
    rejected rather than silently coerced (PaperTrail validates at the boundary)."""
    if "confidence" not in source or source["confidence"] is None:
        return DEFAULT_CONFIDENCE
    raw = source["confidence"]
    if isinstance(raw, bool) or not isinstance(raw, (int, float)):
        raise ValueError("confidence must be a number in [0, 1]")
    value = float(raw)
    if value != value or value in (float("inf"), float("-inf")):
        raise ValueError("confidence must be a finite number in [0, 1]")
    return _clamp(value, 0.0, 1.0)


def _label_of(source: dict) -> str:
    """Read + validate a source's MultiVerS label. Raises ValueError on an unknown label."""
    label = source.get("label")
    if label not in VALID_LABELS:
        raise ValueError(
            "label must be one of SUPPORTS, REFUTES, NEI (MultiVerS taxonomy); got "
            + repr(label)
        )
    return label


def classify(support_mass: float, refute_mass: float, nei_mass: float) -> Tuple[str, bool]:
    """Deterministic verdict from the confidence-weighted masses. Pure and directly
    unit-testable. Mirrors classify() in lib/scieval/crossSourceAggregate.ts.

    Returns (verdict, mixed_flag). `mixed` is True exactly when directional evidence exists
    on both sides and neither side clears DOMINANCE_THRESHOLD."""
    directional = support_mass + refute_mass
    # No directional evidence at all (only NEI, or nothing) -> honest insufficient.
    if directional <= 0.0:
        return "insufficient", False

    support_share = support_mass / directional
    refute_share = refute_mass / directional

    both_sides = support_mass > 0.0 and refute_mass > 0.0

    if support_share >= DOMINANCE_THRESHOLD:
        return "supported", False
    if refute_share >= DOMINANCE_THRESHOLD:
        return "refuted", False

    # Directional mass present, but neither side dominates -> genuine conflict.
    return "mixed", both_sides


def aggregate_cross_source(payload: dict) -> dict:
    """Top-level entry — confidence-weighted cross-source label aggregation. Deterministic
    mirror of aggregateCrossSource() in lib/scieval/crossSourceAggregate.ts.

    Raises ValueError on structurally-invalid input (non-list sources, unknown label, bad
    confidence) so the CLI can emit {"error": ...} + exit 2."""
    sources = payload.get("sources", [])
    if not isinstance(sources, list):
        raise ValueError("`sources` must be a list of {id, label, confidence?} objects")

    support_mass = 0.0
    refute_mass = 0.0
    nei_mass = 0.0
    support_count = 0
    refute_count = 0
    nei_count = 0

    for source in sources:
        if not isinstance(source, dict):
            raise ValueError("each source must be an object with id + label")
        label = _label_of(source)
        confidence = _confidence_of(source)

        if label == SUPPORTS:
            support_mass += confidence
            support_count += 1
        elif label == REFUTES:
            refute_mass += confidence
            refute_count += 1
        else:
            nei_mass += confidence
            nei_count += 1

    verdict, mixed = classify(support_mass, refute_mass, nei_mass)

    # netConfidence: signed net directional mass in [-1, 1], normalized by the directional
    # mass so it reads as "which way, how strongly" independent of the number of sources.
    # +1 = unanimous support, -1 = unanimous refute, 0 = balanced. NEI mass is excluded from
    # the denominator because NEI makes no directional claim.
    directional = support_mass + refute_mass
    net_confidence = ((support_mass - refute_mass) / directional) if directional > 0.0 else 0.0

    if net_confidence > 0.0:
        net_direction = "support"
    elif net_confidence < 0.0:
        net_direction = "refute"
    else:
        net_direction = "none"

    return {
        "verdict": verdict,
        "supportCount": support_count,
        "refuteCount": refute_count,
        "neiCount": nei_count,
        "netConfidence": net_confidence,
        "mixed": mixed,
        "netDirection": net_direction,
        "tally": {
            "supportMass": support_mass,
            "refuteMass": refute_mass,
            "neiMass": nei_mass,
        },
        "consideredCount": len(sources),
    }


def _read_payload(args: argparse.Namespace) -> dict:
    if args.json:
        return json.loads(args.json)
    data = sys.stdin.read()
    if not data.strip():
        return {"sources": []}
    return json.loads(data)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="PaperTrail deterministic cross-source label aggregator (MultiVerS specialization)."
    )
    parser.add_argument("--json", type=str, default=None, help="Inline JSON payload.")
    args = parser.parse_args()

    try:
        payload = _read_payload(args)
    except json.JSONDecodeError as exc:
        print(json.dumps({"error": f"invalid JSON payload: {exc}"}))
        return 2

    if not isinstance(payload, dict):
        print(json.dumps({"error": "payload must be a JSON object with a `sources` array"}))
        return 2

    try:
        result = aggregate_cross_source(payload)
    except ValueError as exc:
        print(json.dumps({"error": str(exc)}))
        return 2

    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
