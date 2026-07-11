#!/usr/bin/env python3
"""PaperTrail specialization of open_deep_research — a deterministic ITERATIVE loop.

This file is a PaperTrail-native specialization of the open_deep_research (ODR) engine
(this repo owns the vendored ODR tree under backend/engines/open_deep_research/).
Upstream ODR runs a supervisor that fans out `ConductResearch` units and then decides,
in an LLM `should_continue` step, whether to research more or write the final report —
the loop-control decision is made by a model. PaperTrail's moat rule forbids that: *no
LLM anywhere in a score, ranking, verdict, or loop-control decision.* So this module
re-implements ODR's iterative research loop as a DETERMINISTIC STATE MACHINE.

Given the evidence accrued SO FAR (per round: pooled study count, total participants,
heterogeneity I², open contradictions), it decides `continue` vs. `stop` and, when it
continues, emits ONE concrete `widen` action for the next round — broaden the query,
add a facet, or raise the retrieval limit — chosen by which sufficiency criterion is
failing. The loop is HARD-CAPPED at a fixed number of rounds so it always terminates.

**No other file in this engine is modified.** This module is standalone Python with NO
third-party imports (no LangGraph, no ODR install, no network), and this whole directory
is excluded from the Next build — zero TypeScript/build impact.

MOAT / reproducibility guarantees (identical to the TS mirror lib/research/iterativeLoop.ts,
which reuses lib/evidencePipeline.ts `evidenceSufficiency`):
  * the SAME four field-standard sufficiency thresholds decide continue/stop:
      >= MIN_STUDIES pooled studies, >= MIN_PARTICIPANTS participants,
      I² < MAX_I_SQUARED (null I² fails), 0 open contradictions
  * the stop/continue decision is pure threshold math — NO LLM, no randomness, no network
  * the widen action is chosen by a fixed priority over the FAILING criteria
  * a hard round cap (MAX_ROUNDS) guarantees termination; the final round can only stop
  * honest insufficiency: when the cap is hit while still insufficient we stop with an
    explicit `cap_reached` reason rather than pretending the evidence is sufficient

Claude never touches a sufficiency check, a continue/stop decision, or a widen action.
Same per-round stats -> same decisions -> same widen actions, always.

USAGE (stdlib only, no install):

    # JSON on stdin: { "rounds": [ {k, participants, iSquared?, openContradictions?}, ... ] }
    #   each round item: {"k": int>=0, "participants": int>=0,
    #                     "iSquared"?: number|null, "openContradictions"?: int>=0}
    echo '{"rounds":[{"k":1,"participants":40,"iSquared":null,"openContradictions":0},
                     {"k":3,"participants":120,"iSquared":48,"openContradictions":0}]}' \
      | python3 papertrail_iterative.py

    # or via --input-file
    python3 papertrail_iterative.py --input-file rounds.json

    # or inline via --arg
    python3 papertrail_iterative.py --arg '{"rounds":[{"k":3,"participants":150,"iSquared":30}]}'

OUTPUT (stdout, JSON):

    {
      "rounds": [
        {"round": 1, "sufficient": false, "decision": "continue",
         "reason": "...", "widen_action": {"type": "raise_limit", "detail": "..."},
         "criteria": {"enoughStudies": false, ...}},
        {"round": 2, "sufficient": true, "decision": "stop",
         "reason": "...", "widen_action": null, "criteria": {...}}
      ],
      "final": {"decision": "stop", "stop_reason": "sufficient",
                "rounds_used": 2, "sufficient": true},
      "meta": {"max_rounds": 3, "rounds_supplied": 2}
    }

The TypeScript mirror lib/research/iterativeLoop.ts consumes/produces exactly this shape,
field-for-field (see PAPERTRAIL.md for the mapping).
"""

from __future__ import annotations

import argparse
import json
import sys
from typing import Any, Dict, List, Optional, Tuple

# ---------------------------------------------------------------------------
# Constants — MUST stay identical to lib/evidencePipeline.ts (evidenceSufficiency)
# and lib/research/iterativeLoop.ts so the offline Python loop and the on-demand TS
# loop make identical continue/stop/widen decisions from identical per-round stats.
# ---------------------------------------------------------------------------

# Field-standard sufficiency thresholds (mirror lib/evidencePipeline.ts).
MIN_STUDIES = 3
MIN_PARTICIPANTS = 100
MAX_I_SQUARED = 75  # percent

# Hard cap on rounds — mirrors MAX_ROUNDS in lib/research/iterativeLoop.ts. The loop
# always terminates: the final round can only stop, never continue.
MAX_ROUNDS = 3

# Widen-action types the loop may emit when it continues. Fixed vocabulary so the TS
# mirror and any UI can switch on them exhaustively.
WIDEN_RAISE_LIMIT = "raise_limit"
WIDEN_ADD_FACET = "add_facet"
WIDEN_BROADEN_QUERY = "broaden_query"

# Stop reasons the final decision may carry.
STOP_SUFFICIENT = "sufficient"
STOP_CAP_REACHED = "cap_reached"


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

    Returns {sufficient, reasons, criteria}. NO LLM: pure threshold math over the
    numbers the deterministic engines already produced. Un-assessable heterogeneity
    (i_squared is None) fails the heterogeneity criterion — we cannot assert
    I² < MAX_I_SQUARED when I² is unknown.
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
# The widen boundary — which concrete action to take next when insufficient.
#
# Chosen by a FIXED priority over the failing criteria (NOT an LLM). Rationale:
# each criterion has a distinct cheapest remedy, and we apply the one that most
# directly addresses the *primary* shortfall so the next round is a targeted widen,
# not a blind re-run:
#   1. too few studies      -> raise the retrieval limit (pull more candidate sources)
#   2. too few participants  -> add a facet (larger trials / pooled cohorts / phase 3)
#   3. high/unknown I²       -> add a facet (constrain population/comparator to reduce
#                               heterogeneity)
#   4. open contradictions   -> broaden the query (surface the resolving/adjudicating
#                               evidence the current query is missing)
# ---------------------------------------------------------------------------


def decide_widen_action(criteria: Dict[str, bool]) -> Dict[str, str]:
    """Pick ONE next widen action from the failing sufficiency criteria (fixed priority).

    Deterministic: given the same criteria it always returns the same action. Only
    called when the round is insufficient AND another round remains, so at least one
    criterion is failing.
    """
    if not criteria["enoughStudies"]:
        return {
            "type": WIDEN_RAISE_LIMIT,
            "detail": (
                "Too few pooled studies — raise the retrieval limit to pull more "
                "candidate primary sources into the next pass."
            ),
        }
    if not criteria["enoughParticipants"]:
        return {
            "type": WIDEN_ADD_FACET,
            "detail": (
                "Too few total participants — add a facet targeting larger trials or "
                "pooled cohorts (e.g. phase-3 / multi-centre) in the next pass."
            ),
        }
    if not criteria["acceptableHeterogeneity"]:
        return {
            "type": WIDEN_ADD_FACET,
            "detail": (
                "Heterogeneity is high or un-assessable — add a facet constraining the "
                "population or comparator to retrieve a more homogeneous evidence set."
            ),
        }
    # By construction, the only remaining failing criterion is open contradictions.
    return {
        "type": WIDEN_BROADEN_QUERY,
        "detail": (
            "Open contradictions between sources — broaden the query to surface the "
            "adjudicating or resolving evidence the current query is missing."
        ),
    }


# ---------------------------------------------------------------------------
# The state machine — walk the supplied rounds, deciding continue/stop each round,
# bounded by MAX_ROUNDS. Pure: builds new dicts, mutates nothing.
# ---------------------------------------------------------------------------


def plan_iterative_rounds(rounds: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Run the deterministic iterative-research state machine over accrued round stats.

    For each round (capped at MAX_ROUNDS): run the sufficiency gate; if sufficient,
    STOP; else if another round remains, CONTINUE with a concrete widen action; else
    (cap reached while insufficient) STOP honestly with `cap_reached`. Returns the
    per-round decisions plus the final decision. NO LLM anywhere in the decision path.
    """
    considered = rounds[:MAX_ROUNDS]
    round_results: List[Dict[str, Any]] = []

    final_sufficient = False
    stop_reason = STOP_CAP_REACHED
    rounds_used = 0

    total = len(considered)
    for index, round_stats in enumerate(considered):
        round_number = index + 1
        rounds_used = round_number
        is_last_supplied = round_number == total
        is_cap = round_number == MAX_ROUNDS
        # A round may continue only if it is neither the last supplied round nor the cap.
        can_continue = not is_last_supplied and not is_cap

        gate = evidence_sufficiency(
            pooled_studies=round_stats["k"],
            total_participants=round_stats["participants"],
            i_squared=round_stats["iSquared"],
            open_contradictions=round_stats["openContradictions"],
        )
        sufficient = bool(gate["sufficient"])

        if sufficient:
            decision = "stop"
            widen_action: Optional[Dict[str, str]] = None
            reason = "Evidence is sufficient — all four criteria met; stopping the loop."
            final_sufficient = True
            stop_reason = STOP_SUFFICIENT
            round_results.append(
                _round_result(round_number, gate, decision, reason, widen_action)
            )
            break

        if can_continue:
            decision = "continue"
            widen_action = decide_widen_action(gate["criteria"])
            reason = (
                "Insufficient evidence — "
                + " ".join(gate["reasons"])
                + f" Widening retrieval (round {round_number + 1})."
            )
            round_results.append(
                _round_result(round_number, gate, decision, reason, widen_action)
            )
            continue

        # Insufficient and no further round permitted (last supplied round or cap).
        decision = "stop"
        widen_action = None
        final_sufficient = False
        if is_cap:
            stop_reason = STOP_CAP_REACHED
            reason = (
                f"Round cap ({MAX_ROUNDS}) reached while still insufficient — "
                + " ".join(gate["reasons"])
                + " Stopping honestly rather than forcing a low-confidence conclusion."
            )
        else:
            stop_reason = STOP_CAP_REACHED
            reason = (
                "No further rounds supplied while still insufficient — "
                + " ".join(gate["reasons"])
                + " Stopping honestly rather than forcing a low-confidence conclusion."
            )
        round_results.append(
            _round_result(round_number, gate, decision, reason, widen_action)
        )
        break

    return {
        "rounds": round_results,
        "final": {
            "decision": "stop",
            "stop_reason": stop_reason,
            "rounds_used": rounds_used,
            "sufficient": final_sufficient,
        },
        "meta": {
            "max_rounds": MAX_ROUNDS,
            "rounds_supplied": len(rounds),
        },
    }


def _round_result(
    round_number: int,
    gate: Dict[str, Any],
    decision: str,
    reason: str,
    widen_action: Optional[Dict[str, str]],
) -> Dict[str, Any]:
    """Assemble one round's decision record (new dict; no mutation)."""
    return {
        "round": round_number,
        "sufficient": bool(gate["sufficient"]),
        "decision": decision,
        "reason": reason,
        "widen_action": widen_action,
        "criteria": gate["criteria"],
    }


# ---------------------------------------------------------------------------
# Input parsing / validation — drop-never-coerce at the boundary. Invalid input is
# reported as {"error": ...} on stdout with exit code 2, never a silent crash.
# ---------------------------------------------------------------------------


class InputError(Exception):
    """Raised for structurally invalid input at the system boundary."""


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


def parse_round(item: Any, index: int) -> Dict[str, Any]:
    """Validate one round item into a normalized {k, participants, iSquared, openContradictions}."""
    if not isinstance(item, dict):
        raise InputError(f"rounds[{index}] must be an object.")
    k = _require_int(item.get("k"), f"rounds[{index}].k", 0)
    participants = _require_int(
        item.get("participants"), f"rounds[{index}].participants", 0
    )
    try:
        i_squared = _parse_i_squared(item.get("iSquared"))
    except InputError as exc:
        raise InputError(f"rounds[{index}].{exc}") from exc
    raw_contradictions = item.get("openContradictions", 0)
    open_contradictions = _require_int(
        raw_contradictions, f"rounds[{index}].openContradictions", 0
    )
    return {
        "k": k,
        "participants": participants,
        "iSquared": i_squared,
        "openContradictions": open_contradictions,
    }


def parse_input(payload: Any) -> List[Dict[str, Any]]:
    """Validate the top-level payload into a list of normalized round stats."""
    if not isinstance(payload, dict):
        raise InputError("Input must be a JSON object with a `rounds` array.")
    rounds = payload.get("rounds")
    if not isinstance(rounds, list):
        raise InputError("`rounds` must be an array.")
    if len(rounds) == 0:
        raise InputError("`rounds` must contain at least one round.")
    return [parse_round(item, i) for i, item in enumerate(rounds)]


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
            "Deterministic iterative evidence-sufficiency research loop "
            "(PaperTrail specialization of open_deep_research)."
        )
    )
    parser.add_argument(
        "--arg",
        default=None,
        help="Inline JSON input string ({\"rounds\": [...]}).",
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
        rounds = parse_input(payload)
    except InputError as exc:
        _fail(str(exc))
        return

    result = plan_iterative_rounds(rounds)
    json.dump(result, sys.stdout)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
