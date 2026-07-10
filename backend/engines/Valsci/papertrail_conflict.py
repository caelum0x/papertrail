#!/usr/bin/env python3
# PAPERTRAIL-NATIVE CONTRADICTION RESOLVER — a specialization of the Valsci engine, owned
# by PaperTrail (this repo). See PAPERTRAIL.md in this directory.
#
# WHY THIS FILE EXISTS
# --------------------
# Valsci's shipped pipeline (processor.py + prompts/final_report_*.txt) does:
#   gather papers -> per-paper `analyze_relevance_and_extract` (relevance 0..1 + verbatim
#   excerpts; papers with `relevance >= 0.1` are kept, processor.py:1076) -> an LLM in
#   `final_report_system.txt` synthesizes the excerpts into ONE ordinal claimRating
#   (Contradicted / Likely False / Mixed Evidence / Likely True / Highly Supported /
#   No Evidence). When that rating is "Mixed Evidence", Valsci stops at "the evidence
#   conflicts" — it does NOT explain WHY the two sides disagree.
#
# PaperTrail's MOAT rule is: NO LLM in the verdict/numeric/attribution path. So this file
# ports the CONTRADICTION-RESOLUTION LOOP that Valsci implies but never makes deterministic:
# given the per-paper signed supports + excerpts already produced (upstream, by the TS
# lib/scieval/valsci port), it DETERMINISTICALLY:
#   1. partitions papers into supporting vs refuting by the SIGN of their support score,
#   2. reads each paper's grounded study-DESIGN features (population / dose / tissue /
#      follow_up) — the candidate dimension is tagged by the LLM upstream, but here it is
#      only compared, never judged,
#   3. attributes the reversal to the highest-strength dimension whose values DIFFER across
#      the two sides (coverage- + belief-weighted, all rule-scored), and
#   4. emits {resolution_category, primary_hypothesis, supporting_count} — the exact shape
#      the roadmap names for this specialization.
#
# This is the Python mirror of the TypeScript contract in lib/contradiction/atlas.ts +
# lib/contradiction/schemas.ts. It is the deterministic cross-check for the hot-path TS
# implementation (roadmap risk #4: "prefer native TS on hot paths with the Python engine as
# cross-check"). No other file in this engine is modified.
#
# CONTRACT (mirrors lib/contradiction/atlas.ts)
# ---------------------------------------------
#   * Deterministic: no model calls, no network. Same input -> same output, always.
#   * Every quote is expected to already be a VERBATIM substring of its source (grounded
#     upstream by lib/grounding locateSpan). This file does not re-ground; it trusts the
#     grounded features it is handed and never invents a quote.
#   * Side assignment is by the SIGN of `support` (support > 0 -> supporting, < 0 ->
#     refuting, 0 -> excluded), exactly like the TS atlas `sideForSupport`.
#   * A dimension "differs" only when BOTH sides report it AND their value sets are
#     disjoint (case-insensitive) — the structural signature of a design-driven reversal.
#   * Honest abstention: both sides present but no dimension clears the strength floor ->
#     `unattributed_conflict`; one side empty -> `no_conflict`; too few sides ->
#     `insufficient`. Never forces an attribution.
#
# I/O (argparse):
#   JSON on stdin, or --json '{...}':
#     { "claim": str,
#       "sources": [ { "source_type", "external_id", "title"?, "support" (-1..1),
#                      "relevance" (0..1), "mechanism_belief" (0..1)?,
#                      "features": [ { "dimension", "value", "quote" } ] } ] }
#   Prints ONE JSON object to stdout mirroring ContradictionAtlasResult:
#     { "resolution_category", "primary_hypothesis" | null, "supporting_count",
#       "refuting_count", "attributions": [...], ... }
#
# Standalone: `python papertrail_conflict.py --json '{...}'`. Imports only the Python
# standard library (no Valsci install, no network). This directory is excluded from the
# Next build, so there is zero TypeScript impact.

import argparse
import json
import sys
from typing import Dict, List, Optional, Tuple

# The closed vocabulary of design dimensions (mirrors CONFLICT_DIMENSIONS in schemas.ts).
CONFLICT_DIMENSIONS: Tuple[str, ...] = ("population", "dose", "tissue", "follow_up")

DIMENSION_LABEL: Dict[str, str] = {
    "population": "study population",
    "dose": "dose / exposure",
    "tissue": "tissue / assay system",
    "follow_up": "follow-up duration",
}

# Deterministic tuning constants — FIXED, documented, identical to lib/contradiction/atlas.ts
# so the Python cross-check and the TS hot path produce the same attribution by hand.
MIN_SIDES_WITH_FEATURE = 2
COVERAGE_WEIGHT = 0.7
BELIEF_WEIGHT = 0.3
MIN_ATTRIBUTION_STRENGTH = 0.35
MIN_SIDE_SIZE = 1

# Valsci's own relevance gate (processor.py:1076 `if relevance >= 0.1`). A source below the
# floor contributes no excerpt and no weight — dropped before it can join a side.
RELEVANCE_FLOOR = 0.1


def _side_for_support(support: float) -> Optional[str]:
    """Deterministic side by the sign of the signed support score (mirrors sideForSupport)."""
    if support > 0:
        return "supporting"
    if support < 0:
        return "refuting"
    return None


def _features_for_dimension(sources: List[dict], dimension: str) -> List[dict]:
    out: List[dict] = []
    for s in sources:
        for f in s.get("features", []):
            if f.get("dimension") == dimension:
                out.append(f)
    return out


def _values(features: List[dict]) -> List[str]:
    return [str(f.get("value", "")).strip() for f in features if str(f.get("value", "")).strip()]


def _lower_set(values: List[str]) -> set:
    return {v.strip().lower() for v in values}


def _mean_belief(sources: List[dict]) -> float:
    if not sources:
        return 0.0
    return sum(float(s.get("mechanism_belief", 0.0) or 0.0) for s in sources) / len(sources)


def _sources_reporting(sources: List[dict], dimension: str) -> List[dict]:
    return [s for s in sources if any(f.get("dimension") == dimension for f in s.get("features", []))]


def score_dimension(dimension: str, supporting: List[dict], refuting: List[dict]) -> dict:
    """Deterministic per-dimension attribution — the exact logic of scoreDimension() in
    lib/contradiction/atlas.ts. Pure: does one dimension's difference explain the reversal,
    and how strongly?"""
    sup_features = _features_for_dimension(supporting, dimension)
    ref_features = _features_for_dimension(refuting, dimension)

    sup_values = _values(sup_features)
    ref_values = _values(ref_features)

    sides_with_feature = (1 if sup_features else 0) + (1 if ref_features else 0)

    sup_set = _lower_set(sup_values)
    ref_set = _lower_set(ref_values)
    overlap = any(v in ref_set for v in sup_set)
    differs = (
        sides_with_feature >= MIN_SIDES_WITH_FEATURE
        and len(sup_set) > 0
        and len(ref_set) > 0
        and not overlap
    )

    sup_cov = (len(_sources_reporting(supporting, dimension)) / len(supporting)) if supporting else 0.0
    ref_cov = (len(_sources_reporting(refuting, dimension)) / len(refuting)) if refuting else 0.0
    coverage = (sup_cov + ref_cov) / 2.0

    belief_backing = (
        _mean_belief(_sources_reporting(supporting, dimension))
        + _mean_belief(_sources_reporting(refuting, dimension))
    ) / 2.0

    strength = (COVERAGE_WEIGHT * coverage + BELIEF_WEIGHT * belief_backing) if differs else 0.0

    return {
        "dimension": dimension,
        "differs": differs,
        "strength": strength,
        "supporting_values": list(dict.fromkeys(sup_values)),
        "refuting_values": list(dict.fromkeys(ref_values)),
    }


def resolve(supporting: List[dict], refuting: List[dict]) -> dict:
    """Deterministic resolution + primary-hypothesis selection (mirrors resolve() in atlas.ts)."""
    attributions = sorted(
        (score_dimension(d, supporting, refuting) for d in CONFLICT_DIMENSIONS),
        key=lambda a: a["strength"],
        reverse=True,
    )

    if len(supporting) < MIN_SIDE_SIZE or len(refuting) < MIN_SIDE_SIZE:
        return {"category": "no_conflict", "attributions": attributions, "primary": None}

    best = attributions[0] if attributions else None
    if best and best["differs"] and best["strength"] >= MIN_ATTRIBUTION_STRENGTH:
        sup_vals = ", ".join(best["supporting_values"]) or "unspecified"
        ref_vals = ", ".join(best["refuting_values"]) or "unspecified"
        statement = (
            "The reversal is attributed to a difference in "
            + DIMENSION_LABEL[best["dimension"]]
            + ": sources supporting the claim studied "
            + sup_vals
            + ", while sources refuting it studied "
            + ref_vals
            + "."
        )
        return {
            "category": "attributed_reversal",
            "attributions": attributions,
            "primary": {
                "dimension": best["dimension"],
                "statement": statement,
                "strength": best["strength"],
            },
        }

    return {"category": "unattributed_conflict", "attributions": attributions, "primary": None}


def resolve_contradiction(payload: dict) -> dict:
    """Top-level entry — partition, resolve, emit {resolution_category, primary_hypothesis,
    supporting_count} plus the full attribution table. Mirrors resolveContradiction()."""
    claim = str(payload.get("claim", ""))
    sources = payload.get("sources", [])
    if not isinstance(sources, list):
        sources = []

    supporting: List[dict] = []
    refuting: List[dict] = []
    below_floor = 0

    for s in sources:
        relevance = float(s.get("relevance", 0.0) or 0.0)
        if relevance < RELEVANCE_FLOOR:
            below_floor += 1
            continue
        side = _side_for_support(float(s.get("support", 0.0) or 0.0))
        if side is None:
            continue
        if side == "supporting":
            supporting.append(s)
        else:
            refuting.append(s)

    res = resolve(supporting, refuting)

    return {
        "claim": claim,
        "resolution_category": res["category"],
        "primary_hypothesis": res["primary"],
        "supporting_count": len(supporting),
        "refuting_count": len(refuting),
        "attributions": res["attributions"],
        "below_floor_count": below_floor,
        "considered_count": len(sources),
    }


def _read_payload(args: argparse.Namespace) -> dict:
    if args.json:
        return json.loads(args.json)
    data = sys.stdin.read()
    if not data.strip():
        return {"claim": "", "sources": []}
    return json.loads(data)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="PaperTrail deterministic contradiction resolver (Valsci specialization)."
    )
    parser.add_argument("--json", type=str, default=None, help="Inline JSON payload.")
    args = parser.parse_args()

    try:
        payload = _read_payload(args)
    except json.JSONDecodeError as exc:
        print(json.dumps({"error": f"invalid JSON payload: {exc}"}))
        return 1

    result = resolve_contradiction(payload)
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
