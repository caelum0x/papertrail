#!/usr/bin/env python3
# PAPERTRAIL-NATIVE INDRA GROUNDING HOOK — a specialization of the INDRA engine, owned by
# PaperTrail (this repo). See PAPERTRAIL.md in this directory.
#
# WHY THIS FILE EXISTS
# --------------------
# INDRA attaches a `BioContext` (indra/statements/context.py) to every Statement's
# Evidence, made of `RefContext` slots: location / cell_line / cell_type / organ / disease
# / species. And INDRA computes a per-Statement `belief` (indra/belief/__init__.py,
# SimpleScorer): probability the statement is CORRECT = 1 - product over evidence of the
# source-specific incorrectness. Both signals normally live INSIDE INDRA's assembly and are
# never surfaced to a downstream contradiction explainer.
#
# The Quantitative Contradiction Atlas needs exactly those two signals to explain WHY two
# sources disagree about a claim:
#   * the RefContext TISSUE / SPECIES / ASSAY a mechanism was observed in maps onto the
#     atlas's `tissue` and `population` design dimensions (a reversal is often "different
#     cell type / different species"), and
#   * the deterministic BELIEF weights how much a side's mechanism should count.
#
# So this hook does two deterministic things, with NO LLM:
#   1. FLATTEN a BioContext's RefContext slots into the atlas's `population` / `tissue`
#      design-feature vocabulary (indra/statements/context.py BioContext.attrs -> feature
#      dimension), preserving each slot's grounded db_refs so an auditor can trace it.
#   2. Re-derive the SimpleScorer BELIEF (belief = 1 - prod(1 - reliability_i)) from a
#      statement's evidence source list, using INDRA's own default per-source prior probs
#      (indra/resources/default_belief_probs.json) collapsed to a single reliability per
#      source. NO LLM number is load-bearing.
#
# Output feeds the atlas's per-side design features + `mechanism_belief`, i.e. it is the
# Python mirror of what lib/contradiction/atlas.ts consumes from lib/mechanism (belief) and
# the design-feature tagger (tissue/population). No other file in this engine is modified.
#
# CONTRACT (mirrors lib/contradiction/atlas.ts GroundedFeature + mechanism_belief)
# --------------------------------------------------------------------------------
#   * Deterministic: no model calls, no network. Same input -> same output, always.
#   * Belief is re-derived by rule from the source list; never emitted by a model.
#   * A RefContext slot with no grounded name is DROPPED (never assert an ungrounded
#     context), mirroring PaperTrail's "drop the ungroundable" rule.
#   * Honest empty: a statement with no context yields no design features; a statement with
#     no evidence yields belief 0.0.
#
# I/O (argparse):
#   JSON on stdin, or --json '{...}':
#     { "statements": [ { "type"?, "evidence": [ { "source_api"?,
#         "context": { "cell_type"?, "cell_line"?, "organ"?, "species"?, "location"?,
#                      "disease"? } } ] } ] }
#     (each context slot is either a plain string name, or an INDRA RefContext dict
#      {"name": str, "db_refs": {...}})
#   Prints ONE JSON object mirroring the atlas feature/belief shape:
#     { "statements": [ { "belief": float, "features": [ { "dimension", "value", "quote",
#                        "db_refs" } ] } ] }
#
# Standalone: `python grounding_hook.py --json '{...}'`. Imports only the Python standard
# library plus INDRA's own belief-prior JSON when present (falls back to documented
# constants if the resource is absent), so it runs with no INDRA install and no network.
# This directory is excluded from the Next build, so there is zero TypeScript impact.

import argparse
import json
import os
import sys
from typing import Dict, List, Optional, Tuple

# INDRA's BioContext RefContext slots (indra/statements/context.py BioContext.attrs) mapped
# onto the atlas design-dimension vocabulary (lib/contradiction/schemas.ts CONFLICT_DIMENSIONS).
#   cell_type / cell_line / organ / location -> tissue   (where the effect was measured)
#   species / disease                        -> population (who/what was studied)
# follow_up + dose have no RefContext analogue in INDRA and are contributed by the trial-
# design tagger instead — this hook only surfaces what INDRA actually grounds.
CONTEXT_SLOT_TO_DIMENSION: Dict[str, str] = {
    "cell_type": "tissue",
    "cell_line": "tissue",
    "organ": "tissue",
    "location": "tissue",
    "species": "population",
    "disease": "population",
}

# Documented fallback per-source reliability, in the ballpark of INDRA's
# `1 - (syst + rand)` for the corresponding reader/database classes (curated DBs ~0.9,
# reading systems ~0.65). Used only when the default_belief_probs.json resource is absent.
FALLBACK_SOURCE_RELIABILITY: Dict[str, float] = {
    "biopax": 0.9,
    "bel": 0.9,
    "signor": 0.9,
    "reach": 0.65,
    "sparser": 0.65,
    "trips": 0.65,
    "eidos": 0.6,
    "medscan": 0.6,
}
DEFAULT_RELIABILITY = 0.6


def _load_indra_priors() -> Optional[Dict[str, Dict[str, float]]]:
    """Load INDRA's own default_belief_probs.json (indra/resources/) if present. It has the
    structure {"syst": {source: p}, "rand": {source: p}}; per-source reliability is
    1 - (syst + rand), exactly the r_i in SimpleScorer's belief = 1 - prod(1 - r_i)."""
    here = os.path.dirname(os.path.abspath(__file__))
    candidate = os.path.join(here, "indra", "indra", "resources", "default_belief_probs.json")
    if not os.path.exists(candidate):
        candidate = os.path.join(here, "indra", "resources", "default_belief_probs.json")
    if not os.path.exists(candidate):
        return None
    try:
        with open(candidate, "r") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return None


def _source_reliability(source_api: str, priors: Optional[Dict[str, Dict[str, float]]]) -> float:
    """Per-source reliability r_i for INDRA's belief combination. From the loaded priors when
    available (1 - syst - rand, clamped to [0, 1]); else the documented fallback table."""
    key = (source_api or "").strip().lower()
    if priors:
        syst = priors.get("syst", {})
        rand = priors.get("rand", {})
        if key in syst or key in rand:
            reliability = 1.0 - float(syst.get(key, 0.0)) - float(rand.get(key, 0.0))
            return max(0.0, min(1.0, reliability))
    return FALLBACK_SOURCE_RELIABILITY.get(key, DEFAULT_RELIABILITY)


def combine_belief(source_apis: List[str], priors: Optional[Dict[str, Dict[str, float]]]) -> float:
    """INDRA SimpleScorer belief: belief = 1 - prod_i (1 - reliability_i) over the evidence
    sources. Pure + total; mirrors combineBelief() in lib/mechanism/assemble.ts."""
    if not source_apis:
        return 0.0
    product_incorrect = 1.0
    for api in source_apis:
        product_incorrect *= 1.0 - _source_reliability(api, priors)
    return 1.0 - product_incorrect


def _ref_name_and_refs(slot: object) -> Tuple[Optional[str], Dict[str, str]]:
    """A RefContext slot may be a plain string name or an INDRA RefContext dict
    {"name", "db_refs"}. Returns (grounded_name_or_None, db_refs). A slot with no name is
    ungrounded and dropped by the caller."""
    if isinstance(slot, str):
        name = slot.strip()
        return (name or None, {})
    if isinstance(slot, dict):
        name = str(slot.get("name", "")).strip()
        db_refs = slot.get("db_refs", {}) or {}
        if not isinstance(db_refs, dict):
            db_refs = {}
        return (name or None, {str(k): str(v) for k, v in db_refs.items()})
    return (None, {})


def context_to_features(context: dict) -> List[dict]:
    """Flatten one INDRA BioContext into atlas design features (tissue / population),
    dropping ungrounded slots. Each feature carries the grounded slot name as `value`, the
    slot name as `quote` (it is the grounded surface form), and the INDRA db_refs for audit."""
    features: List[dict] = []
    if not isinstance(context, dict):
        return features
    for slot, dimension in CONTEXT_SLOT_TO_DIMENSION.items():
        if slot not in context or context[slot] is None:
            continue
        name, db_refs = _ref_name_and_refs(context[slot])
        if not name:
            continue  # ungrounded RefContext slot — never assert it
        features.append(
            {
                "dimension": dimension,
                "value": name,
                "quote": name,
                "db_refs": db_refs,
                "indra_slot": slot,
            }
        )
    return features


def process_statement(statement: dict, priors: Optional[Dict[str, Dict[str, float]]]) -> dict:
    """Surface one statement's deterministic belief + grounded context features."""
    evidence = statement.get("evidence", [])
    if not isinstance(evidence, list):
        evidence = []

    source_apis = [str(ev.get("source_api", "")) for ev in evidence if isinstance(ev, dict)]
    belief = combine_belief([a for a in source_apis if a], priors)

    features: List[dict] = []
    seen: set = set()
    for ev in evidence:
        if not isinstance(ev, dict):
            continue
        for feat in context_to_features(ev.get("context", {}) or {}):
            key = (feat["dimension"], feat["value"].lower())
            if key in seen:
                continue
            seen.add(key)
            features.append(feat)

    return {"belief": belief, "features": features}


def process(payload: dict) -> dict:
    priors = _load_indra_priors()
    statements = payload.get("statements", [])
    if not isinstance(statements, list):
        statements = []
    out = [process_statement(s, priors) for s in statements if isinstance(s, dict)]
    return {"statements": out}


def _read_payload(args: argparse.Namespace) -> dict:
    if args.json:
        return json.loads(args.json)
    data = sys.stdin.read()
    if not data.strip():
        return {"statements": []}
    return json.loads(data)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="PaperTrail INDRA grounding hook: surface RefContext + belief for the atlas."
    )
    parser.add_argument("--json", type=str, default=None, help="Inline JSON payload.")
    args = parser.parse_args()

    try:
        payload = _read_payload(args)
    except json.JSONDecodeError as exc:
        print(json.dumps({"error": f"invalid JSON payload: {exc}"}))
        return 1

    print(json.dumps(process(payload)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
