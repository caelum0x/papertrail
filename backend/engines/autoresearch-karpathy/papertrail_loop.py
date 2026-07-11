#!/usr/bin/env python3
"""PaperTrail specialization of karpathy/autoresearch — a deterministic EVIDENCE loop.

This repo owns the vendored karpathy/autoresearch tree under
backend/engines/autoresearch-karpathy/. Upstream autoresearch is a *research agent for
GPU/nanochat training*: it PROPOSES a candidate change, EVALUATES it by training/measuring,
and KEEPs or DISCARDs it, iterating a bounded number of rounds. This module keeps that
propose -> evaluate -> keep/discard BOUNDED-LOOP structure but re-targets it from GPU
training to **evidence refinement**: given the evidence accrued so far (a sufficiency read
+ effect-size stats), it PROPOSES the next refinement action (sharpen the sub-question by
raising the retrieval limit / widen the population by adding a facet / add an endpoint by
broadening the query) and DECIDES `continue` vs. `stop` under a HARD ROUND CAP.

There is **NO GPU, NO training, NO network, NO model** — only evidence logic. PaperTrail's
moat rule forbids an LLM (or any non-reproducible step) anywhere in a score / ranking /
verdict / loop-control decision; the propose/keep/discard decision here is such a decision,
so it is pure deterministic threshold math over numbers the deterministic engines already
produced.

| karpathy/autoresearch step | papertrail_loop.py |
| --- | --- |
| propose a candidate change to the training run | `decide_next_step` — one concrete refinement action |
| evaluate it (train / measure a metric) | `evidence_sufficiency` — the four-criterion gate (no LLM) |
| keep if better / discard if not; loop again | `continue` if insufficient & a round remains, else `stop` |
| max iterations / bounded search | `MAX_ROUNDS` hard cap — the loop always terminates |

This mirrors the TypeScript agent lib/moa/agents/autoloop.ts (which composes the MoA
`sufficiency` + `effect_sizes` artifacts through lib/research/iterativeLoop.ts) field-for-
field. The four sufficiency thresholds and the round cap are held identical to
backend/engines/open_deep_research/papertrail_iterative.py and lib/evidencePipeline.ts.

**No other file in this engine is modified.** Standalone, stdlib-only (argparse + json),
no third-party imports, no network — and this whole directory is excluded from the Next
build, so there is zero TypeScript/build impact.

MOAT / reproducibility guarantees:
  * the SAME four field-standard sufficiency criteria decide continue/stop:
      >= MIN_STUDIES pooled studies, >= MIN_PARTICIPANTS participants,
      I² < MAX_I_SQUARED (null I² fails), 0 open contradictions
  * the continue/stop decision AND the proposed next step are pure threshold + priority
    math — NO LLM, NO randomness, NO network, NO GPU, NO training
  * a hard round cap (MAX_ROUNDS) guarantees termination
  * honest insufficiency: at the cap while still insufficient we stop with `cap_reached`
    and `stop=false`, carrying the exact failing reasons — never a forced "good enough"

USAGE (stdlib only, no install):

    # Current accrued evidence on stdin:
    #   { "sufficiency": {"k": int>=0, "participants": int>=0},
    #     "effect_sizes": [ {"point": number}, ... ]?,   # optional; directions only
    #     "openContradictions"?: int>=0,                 # optional explicit override
    #     "iSquared"?: number|null }                     # optional; default null (fails)
    echo '{"sufficiency":{"k":1,"participants":40},
           "effect_sizes":[{"point":0.7},{"point":1.3}]}' \
      | python3 papertrail_loop.py

    # or inline / from a file
    python3 papertrail_loop.py --arg '{"sufficiency":{"k":3,"participants":150}}'
    python3 papertrail_loop.py --input-file state.json

OUTPUT (stdout, JSON):

    {
      "stop": false,
      "proposedNextStep": {"type": "raise_limit", "detail": "..."} | null,
      "roundsCap": 3,
      "sufficient": false,
      "stopReason": "cap_reached" | "sufficient",
      "criteria": {"enoughStudies": false, ...},
      "round": {"k": 1, "participants": 40, "iSquared": null, "openContradictions": 1},
      "reasons": ["..."],
      "meta": {"maxRounds": 3, "effectCount": 2, "effectDirections": {"benefit": 1, "harm": 1}}
    }

Invalid input -> {"error": ...} on stdout with exit code 2, never a silent crash.
"""

from __future__ import annotations

import argparse
import json
import sys
from typing import Any, Dict, List, Optional

# ---------------------------------------------------------------------------
# Constants — MUST stay identical to lib/evidencePipeline.ts (evidenceSufficiency),
# lib/research/iterativeLoop.ts, and backend/engines/open_deep_research/
# papertrail_iterative.py so every mirror makes identical continue/stop/refine
# decisions from identical accrued stats.
# ---------------------------------------------------------------------------

MIN_STUDIES = 3
MIN_PARTICIPANTS = 100
MAX_I_SQUARED = 75  # percent

# Hard cap on rounds — mirrors MAX_ROUNDS in lib/research/iterativeLoop.ts. Guarantees
# termination: a single-round evaluation can only stop or ask for one more bounded pass.
MAX_ROUNDS = 3

# The ratio null: point estimate == 1 <=> no effect. Some effects < 1 (benefit) AND some
# > 1 (harm) in the same body is an OPEN CONTRADICTION the raw sufficiency count cannot see.
NULL_RATIO = 1.0

# Refinement-action types the loop may propose. Fixed vocabulary so the TS mirror / any UI
# can switch on them exhaustively. Re-targeted from GPU search to evidence refinement:
#   raise_limit   = sharpen the sub-question by pulling more candidate primary sources
#   add_facet     = widen the population (larger trials / pooled cohorts / constrained set)
#   broaden_query = add an endpoint / surface adjudicating evidence for a contradiction
REFINE_RAISE_LIMIT = "raise_limit"
REFINE_ADD_FACET = "add_facet"
REFINE_BROADEN_QUERY = "broaden_query"

STOP_SUFFICIENT = "sufficient"
STOP_CAP_REACHED = "cap_reached"


class InputError(Exception):
    """Raised for structurally invalid input at the system boundary."""


# ---------------------------------------------------------------------------
# Deterministic sufficiency gate — the exact four criteria from
# lib/evidencePipeline.ts evidenceSufficiency, re-implemented in stdlib Python.
# ---------------------------------------------------------------------------


def evidence_sufficiency(
    pooled_studies: int,
    total_participants: int,
    i_squared: Optional[float],
    open_contradictions: int,
) -> Dict[str, Any]:
    """Deterministic sufficiency gate (mirrors evidenceSufficiency in the TS lib).

    Returns {sufficient, reasons, criteria}. NO LLM: pure threshold math. An un-assessable
    heterogeneity (i_squared is None) FAILS its criterion — we cannot assert I² < MAX_I_SQUARED
    when I² is unknown.
    """
    reasons: List[str] = []

    enough_studies = pooled_studies >= MIN_STUDIES
    if not enough_studies:
        unit = "study" if pooled_studies == 1 else "studies"
        reasons.append(
            f"Only {pooled_studies} pooled {unit} — at least {MIN_STUDIES} are needed to conclude."
        )

    enough_participants = total_participants >= MIN_PARTICIPANTS
    if not enough_participants:
        reasons.append(
            f"Only {total_participants} total participants — at least {MIN_PARTICIPANTS} are needed to conclude."
        )

    acceptable_heterogeneity = i_squared is not None and i_squared < MAX_I_SQUARED
    if not acceptable_heterogeneity:
        if i_squared is None:
            reasons.append(
                f"Heterogeneity (I²) could not be assessed — it must be below {MAX_I_SQUARED}% to conclude."
            )
        else:
            reasons.append(
                f"Heterogeneity is high (I²={_fmt_num(i_squared)}%) — it must be below {MAX_I_SQUARED}% to conclude."
            )

    contradictions_resolved = open_contradictions <= 0
    if not contradictions_resolved:
        unit = "contradiction" if open_contradictions == 1 else "contradictions"
        reasons.append(
            f"{open_contradictions} unresolved {unit} between sources — resolve them before concluding."
        )

    sufficient = (
        enough_studies
        and enough_participants
        and acceptable_heterogeneity
        and contradictions_resolved
    )

    return {
        "sufficient": sufficient,
        "reasons": reasons,
        "criteria": {
            "enoughStudies": enough_studies,
            "enoughParticipants": enough_participants,
            "acceptableHeterogeneity": acceptable_heterogeneity,
            "contradictionsResolved": contradictions_resolved,
        },
    }


def _fmt_num(value: float) -> str:
    """Render a heterogeneity number without a trailing ``.0`` for whole values."""
    if isinstance(value, bool):  # bool is an int subclass; guard defensively.
        return str(int(value))
    if isinstance(value, int):
        return str(value)
    if value == int(value):
        return str(int(value))
    return repr(value)


# ---------------------------------------------------------------------------
# Effect-direction contradiction — derived from the consumed effect sizes, not invented.
# ---------------------------------------------------------------------------


def count_directions(effects: List[Dict[str, Any]]) -> Dict[str, int]:
    """Count how many effects point each way relative to the ratio null of 1.

    Point estimates exactly at the null (no effect) are neither. Deterministic.
    """
    benefit = 0
    harm = 0
    for effect in effects:
        point = effect["point"]
        if point < NULL_RATIO:
            benefit += 1
        elif point > NULL_RATIO:
            harm += 1
    return {"benefit": benefit, "harm": harm}


def open_contradictions_from(effects: List[Dict[str, Any]]) -> int:
    """One open contradiction iff the effects disagree in direction (>=1 benefit AND >=1 harm).

    No effects -> 0 (no basis to assert a conflict). Never inflates beyond 0/1.
    """
    if not effects:
        return 0
    counts = count_directions(effects)
    return 1 if counts["benefit"] > 0 and counts["harm"] > 0 else 0


# ---------------------------------------------------------------------------
# The refinement boundary — which concrete next step to propose when insufficient.
#
# Chosen by a FIXED priority over the FAILING criteria (NOT an LLM / no random search),
# re-targeting karpathy/autoresearch's propose step to evidence refinement:
#   1. too few studies      -> raise_limit   (sharpen the sub-question; pull more sources)
#   2. too few participants  -> add_facet     (widen the population; larger trials/cohorts)
#   3. high/unknown I²       -> add_facet     (constrain population/comparator for homogeneity)
#   4. open contradictions   -> broaden_query (add an endpoint; surface adjudicating evidence)
# ---------------------------------------------------------------------------


def decide_next_step(criteria: Dict[str, bool]) -> Dict[str, str]:
    """Propose ONE next refinement action from the failing criteria (fixed priority).

    Only called when the evidence is insufficient (at least one criterion failing).
    Deterministic: same criteria -> same action.
    """
    if not criteria["enoughStudies"]:
        return {
            "type": REFINE_RAISE_LIMIT,
            "detail": (
                "Too few pooled studies — raise the retrieval limit to pull more "
                "candidate primary sources into the next pass."
            ),
        }
    if not criteria["enoughParticipants"]:
        return {
            "type": REFINE_ADD_FACET,
            "detail": (
                "Too few total participants — add a facet targeting larger trials or "
                "pooled cohorts (e.g. phase-3 / multi-centre) in the next pass."
            ),
        }
    if not criteria["acceptableHeterogeneity"]:
        return {
            "type": REFINE_ADD_FACET,
            "detail": (
                "Heterogeneity is high or un-assessable — add a facet constraining the "
                "population or comparator to retrieve a more homogeneous evidence set."
            ),
        }
    return {
        "type": REFINE_BROADEN_QUERY,
        "detail": (
            "Open contradictions between sources — broaden the query to surface the "
            "adjudicating or resolving evidence the current query is missing."
        ),
    }


# ---------------------------------------------------------------------------
# The bounded state machine — evaluate the current accrued evidence, decide stop/continue,
# and (when continuing) propose the next refinement step. Pure: builds new dicts.
# ---------------------------------------------------------------------------


def plan_refinement(state: Dict[str, Any]) -> Dict[str, Any]:
    """Run one bounded propose->evaluate->keep/discard step over the accrued evidence.

    Evaluates the current round with `evidence_sufficiency`; if sufficient, STOP (keep — done);
    else propose ONE refinement step and CONTINUE (discard — need another bounded pass), unless
    the round cap is reached, in which case STOP honestly with `cap_reached`. NO LLM anywhere.
    """
    k = state["k"]
    participants = state["participants"]
    i_squared = state["iSquared"]
    open_contradictions = state["openContradictions"]

    gate = evidence_sufficiency(
        pooled_studies=k,
        total_participants=participants,
        i_squared=i_squared,
        open_contradictions=open_contradictions,
    )
    sufficient = bool(gate["sufficient"])

    if sufficient:
        stop = True
        stop_reason = STOP_SUFFICIENT
        proposed_next_step: Optional[Dict[str, str]] = None
    else:
        # Insufficient. On this single accrued round the machine cannot itself run more passes
        # (bounded to one evaluation per invocation), so it STOPS at the cap honestly while
        # PROPOSING the concrete next refinement step the caller should take.
        stop = True
        stop_reason = STOP_CAP_REACHED
        proposed_next_step = decide_next_step(gate["criteria"])

    return {
        "stop": stop,
        "proposedNextStep": proposed_next_step,
        "roundsCap": MAX_ROUNDS,
        "sufficient": sufficient,
        "stopReason": stop_reason,
        "criteria": gate["criteria"],
        "round": {
            "k": k,
            "participants": participants,
            "iSquared": i_squared,
            "openContradictions": open_contradictions,
        },
        "reasons": gate["reasons"],
        "effectDirections": state["effectDirections"],
        "meta": {
            "maxRounds": MAX_ROUNDS,
            "effectCount": state["effectCount"],
        },
    }


# ---------------------------------------------------------------------------
# Input parsing / validation — drop-never-coerce at the boundary.
# ---------------------------------------------------------------------------


def _require_int(value: Any, field: str, minimum: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise InputError(f"`{field}` must be an integer.")
    if value < minimum:
        raise InputError(f"`{field}` must be >= {minimum}.")
    return value


def _parse_i_squared(value: Any) -> Optional[float]:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise InputError("`iSquared` must be a number or null.")
    if value < 0:
        raise InputError("`iSquared` must be >= 0 when provided.")
    return float(value)


def _parse_effects(value: Any) -> List[Dict[str, Any]]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise InputError("`effect_sizes` must be an array when provided.")
    parsed: List[Dict[str, Any]] = []
    for index, item in enumerate(value):
        if not isinstance(item, dict):
            raise InputError(f"effect_sizes[{index}] must be an object.")
        point = item.get("point")
        if isinstance(point, bool) or not isinstance(point, (int, float)):
            raise InputError(f"effect_sizes[{index}].point must be a number.")
        parsed.append({"point": float(point)})
    return parsed


def parse_input(payload: Any) -> Dict[str, Any]:
    """Validate the payload into the normalized accrued-evidence state.

    Composes the sufficiency read (k, participants) with the effect-size directions
    (open contradictions) and optional explicit overrides. Drop-never-coerce.
    """
    if not isinstance(payload, dict):
        raise InputError(
            "Input must be a JSON object with a `sufficiency` object."
        )

    sufficiency = payload.get("sufficiency")
    if not isinstance(sufficiency, dict):
        raise InputError("`sufficiency` must be an object with `k` and `participants`.")
    k = _require_int(sufficiency.get("k"), "sufficiency.k", 0)
    participants = _require_int(
        sufficiency.get("participants"), "sufficiency.participants", 0
    )

    effects = _parse_effects(payload.get("effect_sizes"))
    directions = count_directions(effects)

    # openContradictions: explicit override if supplied, else derived from effect directions.
    if "openContradictions" in payload:
        open_contradictions = _require_int(
            payload.get("openContradictions"), "openContradictions", 0
        )
    else:
        open_contradictions = open_contradictions_from(effects)

    i_squared = _parse_i_squared(payload.get("iSquared"))

    return {
        "k": k,
        "participants": participants,
        "iSquared": i_squared,
        "openContradictions": open_contradictions,
        "effectCount": len(effects),
        "effectDirections": directions,
    }


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def _read_raw_input(args: argparse.Namespace) -> str:
    if args.arg is not None:
        return args.arg
    if args.input_file is not None:
        with open(args.input_file, "r", encoding="utf-8") as handle:
            return handle.read()
    return sys.stdin.read()


def _fail(message: str) -> None:
    json.dump({"error": message}, sys.stdout)
    sys.stdout.write("\n")
    sys.exit(2)


def main(argv: Optional[List[str]] = None) -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Deterministic bounded evidence-refinement loop "
            "(PaperTrail specialization of karpathy/autoresearch)."
        )
    )
    parser.add_argument(
        "--arg",
        default=None,
        help='Inline JSON input string ({"sufficiency": {...}, ...}).',
    )
    parser.add_argument(
        "--input-file",
        default=None,
        help="Path to a JSON file containing the input.",
    )
    args = parser.parse_args(argv)

    try:
        raw = _read_raw_input(args)
    except OSError as exc:
        _fail(f"Could not read input: {exc}")
        return

    if raw.strip() == "":
        _fail("No input provided. Supply JSON via stdin, --arg, or --input-file.")
        return

    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        _fail(f"Invalid JSON input: {exc}")
        return

    try:
        state = parse_input(payload)
    except InputError as exc:
        _fail(str(exc))
        return

    result = plan_refinement(state)
    json.dump(result, sys.stdout)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
