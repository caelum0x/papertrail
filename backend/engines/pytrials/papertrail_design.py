"""PaperTrail specialization of pytrials: ELIGIBILITY GATES + DESIGN-CREDIBILITY priors.

Upstream ``pytrials`` is a thin client over the ClinicalTrials.gov study API — it
FETCHES structured trial records but says nothing about how far to TRUST a given
trial's design when a claim leans on it. PaperTrail is a provenance/verification
tool, so it needs exactly that: a deterministic read of a trial's eligibility block
(what gates a subject in/out) and a deterministic CREDIBILITY PRIOR derived from the
trial's structured design fields (randomized? blinded? big enough? late enough phase?).

This module adds both, IN PLACE, with no LLM and no network anywhere in the path:

1. ``parse_eligibility(text)`` — split a free-text eligibility blob into
   ``inclusion[]`` / ``exclusion[]`` gates using heading + bullet rules only. The
   registry writes the blob in a few common layouts (an "Inclusion Criteria:" heading
   with bullets, then "Exclusion Criteria:", or plain newline lists); we split on the
   headings, then on bullets/newlines, and strip bullet markers. Anything before the
   first recognized heading is treated as inclusion context (the common "criteria then
   exclusions" layout). Pure string work — same input always yields the same gates.

2. ``score_design_credibility(fields)`` — map structured design fields to a
   CREDIBILITY TIER (``high`` / ``moderate`` / ``low`` / ``very_low``) and a PRIOR
   WEIGHT in ``[0, 1]``, with a transparent list of the FACTORS that moved the score.
   This is a *prior on the trial's design strength* — a supporting weight; it never
   decides a verdict by itself. The verdict math lives in the deterministic
   verification path. This only tells the caller how much design credibility to grant.

Credibility rubric (additive points over a base, then binned to a tier):

    Start from a base of 0 points, add:
      - randomized == true                         -> +2  ("randomized allocation")
      - blinding == "double" (or "triple"+)        -> +2  ("double-blind")
        blinding == "single"                       -> +1  ("single-blind")
        blinding == "open"/"none"                  -> +0  ("open-label")
      - enrollment band (deterministic size bands):
            >= LARGE_ENROLLMENT   (1000)           -> +3  ("large enrollment")
            >= MEDIUM_ENROLLMENT   (300)           -> +2  ("moderate enrollment")
            >= SMALL_ENROLLMENT     (50)           -> +1  ("small enrollment")
            < SMALL_ENROLLMENT                     -> +0  ("very small enrollment")
      - phase (later confirmatory phases score higher):
            PHASE3 / PHASE4                        -> +2  ("late-phase confirmatory")
            PHASE2 (incl. PHASE1/PHASE2, PHASE2/3) -> +1  ("mid-phase")
            PHASE1 / EARLY_PHASE1                  -> +0  ("early-phase")

    The points are summed (max 9) and binned to a tier + prior weight:
            points >= HIGH_CUTOFF      (7)  -> "high"      priorWeight 1.00
            points >= MODERATE_CUTOFF  (4)  -> "moderate"  priorWeight 0.70
            points >= LOW_CUTOFF       (2)  -> "low"       priorWeight 0.40
            points <  LOW_CUTOFF            -> "very_low"  priorWeight 0.20

    The prior weight is what a synthesis step multiplies a trial's design-derived
    evidence contribution by, so a large randomized double-blind Phase 3 trial
    (points 9 -> high -> 1.00) counts for five times the design-prior of a tiny
    open-label Phase 1 study (points 0 -> very_low -> 0.20).

Governance: this module handles only trial DESIGN METADATA (booleans, an integer
enrollment, an opaque phase string) and the eligibility text the CALLER passes in;
its numeric output (tier, weight, factors, gate COUNTS) is metadata-only and safe to
log. The parsed gate STRINGS echo back the caller's own eligibility text and are not
logged by the wiring layer.

CLI: reads a JSON object on ``--arg`` or from stdin, prints JSON to stdout. On bad
input it prints ``{"error": ...}`` and exits 2.

    echo '{"design":{"randomized":true,"blinding":"double","enrollment":1200,"phase":"PHASE3"}}' \\
        | python papertrail_design.py
    python papertrail_design.py --arg '{"eligibility":"Inclusion Criteria:\\n- Age >= 18\\nExclusion Criteria:\\n- Pregnancy"}'
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass
from typing import Any, Optional

# --- Rubric constants (single source of truth; mirrored in lib/sources/trialDesign.ts) ---

# Enrollment size bands (participant counts, inclusive lower bounds).
LARGE_ENROLLMENT = 1000
MEDIUM_ENROLLMENT = 300
SMALL_ENROLLMENT = 50

# Points awarded per structured design factor.
RANDOMIZED_POINTS = 2
BLINDING_DOUBLE_POINTS = 2
BLINDING_SINGLE_POINTS = 1
ENROLLMENT_LARGE_POINTS = 3
ENROLLMENT_MEDIUM_POINTS = 2
ENROLLMENT_SMALL_POINTS = 1
PHASE_LATE_POINTS = 2
PHASE_MID_POINTS = 1

# Tier cut-offs over the summed points (max 9) and their prior weights.
HIGH_CUTOFF = 7
MODERATE_CUTOFF = 4
LOW_CUTOFF = 2

PRIOR_WEIGHT_BY_TIER = {
    "high": 1.00,
    "moderate": 0.70,
    "low": 0.40,
    "very_low": 0.20,
}

TIER_LABEL = {
    "high": "high design credibility",
    "moderate": "moderate design credibility",
    "low": "low design credibility",
    "very_low": "very low design credibility",
}

# --- Eligibility parsing (deterministic; mirrors lib/trialMatcher/eligibility.ts) ---

_INCLUSION_HEADING = re.compile(r"inclusion\s+criteria\s*:?", re.IGNORECASE)
_EXCLUSION_HEADING = re.compile(r"exclusion\s+criteria\s*:?", re.IGNORECASE)

# Leading bullet / numeric / lettered markers to strip from a criterion line.
_BULLET_MARKER = re.compile(
    r"^\s*(?:[-*•·‣▪◦]|\d+[.)]|[a-z][.)]|\([a-z0-9]+\))\s*",
    re.IGNORECASE,
)
# Split points: newlines OR a mid-line bullet marker preceded by whitespace.
_SPLIT_POINTS = re.compile(r"\r?\n|(?=\s[-*•·‣▪◦]\s)")


def _clean_criterion(line: str) -> str:
    """Strip a leading bullet/number marker and surrounding whitespace."""
    return _BULLET_MARKER.sub("", line, count=1).strip()


def _split_criteria(block: str) -> list[str]:
    """Split a block of text into individual criterion strings."""
    parts = _SPLIT_POINTS.split(block)
    cleaned = [_clean_criterion(p) for p in parts]
    return [c for c in cleaned if len(c) > 0]


def parse_eligibility(raw: Any) -> dict[str, list[str]]:
    """Split a free-text eligibility blob into inclusion/exclusion gates.

    Pure string work — no LLM, no I/O. Returns ``{"inclusion": [...],
    "exclusion": [...]}``. A non-string or empty input yields two empty lists
    (honest "no gates" rather than a fabricated split).
    """
    if not isinstance(raw, str) or raw.strip() == "":
        return {"inclusion": [], "exclusion": []}

    excl_match = _EXCLUSION_HEADING.search(raw)
    incl_match = _INCLUSION_HEADING.search(raw)

    # No exclusion heading: everything is inclusion (drop a leading inclusion heading).
    if excl_match is None:
        body = raw[incl_match.end():] if incl_match is not None else raw
        return {"inclusion": _split_criteria(body), "exclusion": []}

    excl_start = excl_match.start()
    # Inclusion block: from just after the inclusion heading (or start) up to the
    # exclusion heading. Anything before the first heading is inclusion context.
    if incl_match is not None and incl_match.start() < excl_start:
        incl_heading_end = incl_match.end()
    else:
        incl_heading_end = 0
    inclusion_block = raw[incl_heading_end:excl_start]
    exclusion_block = raw[excl_start + (excl_match.end() - excl_match.start()):]

    return {
        "inclusion": _split_criteria(inclusion_block),
        "exclusion": _split_criteria(exclusion_block),
    }


# --- Design credibility scoring (deterministic; NO LLM) ------------------------


@dataclass(frozen=True)
class DesignFields:
    """Normalized, defensively-narrowed structured design fields."""

    randomized: Optional[bool]
    blinding: Optional[str]  # normalized: "double" | "single" | "open" | None
    enrollment: Optional[int]
    phase: Optional[str]  # normalized upper-case phase token, or None


@dataclass(frozen=True)
class CredibilityResult:
    """Deterministic tier + prior weight + the factors that moved the score."""

    tier: str  # "high" | "moderate" | "low" | "very_low"
    prior_weight: float
    points: int
    factors: list[str]

    def to_dict(self) -> dict[str, Any]:
        return {
            "tier": self.tier,
            "tierLabel": TIER_LABEL[self.tier],
            "priorWeight": self.prior_weight,
            "points": self.points,
            "factors": list(self.factors),
        }


def _as_optional_bool(value: Any) -> Optional[bool]:
    if isinstance(value, bool):
        return value
    return None


def _as_optional_int(value: Any) -> Optional[int]:
    if isinstance(value, bool):  # bool is an int subclass — reject it explicitly
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value == value and value not in (
        float("inf"),
        float("-inf"),
    ):
        return int(value)
    return None


def _normalize_blinding(value: Any) -> Optional[str]:
    """Collapse the many registry blinding spellings to double/single/open."""
    if not isinstance(value, str):
        return None
    text = value.strip().lower()
    if text == "":
        return None
    if any(k in text for k in ("double", "triple", "quadruple")):
        return "double"
    if "single" in text:
        return "single"
    if any(k in text for k in ("open", "none", "no masking", "unmask")):
        return "open"
    # An unrecognized non-empty masking string is treated as open (no credit granted).
    return "open"


def _normalize_phase(value: Any) -> Optional[str]:
    if not isinstance(value, str):
        return None
    text = value.strip().upper()
    return text or None


def _normalize_design(raw: Any) -> DesignFields:
    """Coerce a raw design object into DesignFields, or raise ValueError."""
    if not isinstance(raw, dict):
        raise ValueError("'design' must be a JSON object")
    return DesignFields(
        randomized=_as_optional_bool(raw.get("randomized")),
        blinding=_normalize_blinding(raw.get("blinding")),
        enrollment=_as_optional_int(raw.get("enrollment")),
        phase=_normalize_phase(raw.get("phase")),
    )


def _phase_points(phase: Optional[str]) -> tuple[int, str]:
    """Late confirmatory phases score higher. Returns (points, factor label)."""
    if phase is None:
        return 0, "phase not reported"
    # PHASE3 / PHASE4 (and combined tokens containing 3 or 4) are late-phase.
    if "PHASE4" in phase or "PHASE3" in phase:
        return PHASE_LATE_POINTS, "late-phase confirmatory (Phase 3/4)"
    if "PHASE2" in phase:
        return PHASE_MID_POINTS, "mid-phase (Phase 2)"
    if "PHASE1" in phase or "EARLY_PHASE1" in phase:
        return 0, "early-phase (Phase 1)"
    return 0, "non-standard phase"


def _enrollment_points(enrollment: Optional[int]) -> tuple[int, str]:
    """Deterministic size bands. Returns (points, factor label)."""
    if enrollment is None or enrollment < 0:
        return 0, "enrollment not reported"
    if enrollment >= LARGE_ENROLLMENT:
        return ENROLLMENT_LARGE_POINTS, f"large enrollment ({enrollment})"
    if enrollment >= MEDIUM_ENROLLMENT:
        return ENROLLMENT_MEDIUM_POINTS, f"moderate enrollment ({enrollment})"
    if enrollment >= SMALL_ENROLLMENT:
        return ENROLLMENT_SMALL_POINTS, f"small enrollment ({enrollment})"
    return 0, f"very small enrollment ({enrollment})"


def _blinding_points(blinding: Optional[str]) -> tuple[int, str]:
    if blinding == "double":
        return BLINDING_DOUBLE_POINTS, "double-blind (or greater)"
    if blinding == "single":
        return BLINDING_SINGLE_POINTS, "single-blind"
    if blinding == "open":
        return 0, "open-label (no blinding)"
    return 0, "blinding not reported"


def _tier_for_points(points: int) -> str:
    if points >= HIGH_CUTOFF:
        return "high"
    if points >= MODERATE_CUTOFF:
        return "moderate"
    if points >= LOW_CUTOFF:
        return "low"
    return "very_low"


def score_design_credibility(fields: DesignFields) -> CredibilityResult:
    """Deterministically score a trial's design credibility.

    Pure function of ``fields`` — no LLM, no I/O. Sums transparent per-factor
    points, bins them to a tier, and reports the factors. Returns a NEW result;
    the input is not mutated. See the module docstring for the full rubric.
    """
    factors: list[str] = []
    points = 0

    if fields.randomized is True:
        points += RANDOMIZED_POINTS
        factors.append("randomized allocation")
    elif fields.randomized is False:
        factors.append("non-randomized allocation")
    else:
        factors.append("randomization not reported")

    b_pts, b_label = _blinding_points(fields.blinding)
    points += b_pts
    factors.append(b_label)

    e_pts, e_label = _enrollment_points(fields.enrollment)
    points += e_pts
    factors.append(e_label)

    p_pts, p_label = _phase_points(fields.phase)
    points += p_pts
    factors.append(p_label)

    tier = _tier_for_points(points)
    return CredibilityResult(
        tier=tier,
        prior_weight=PRIOR_WEIGHT_BY_TIER[tier],
        points=points,
        factors=factors,
    )


# --- Top-level payload handling ------------------------------------------------


def analyze_trial_design(payload: Any) -> dict[str, Any]:
    """Parse eligibility and/or score design credibility from one payload.

    Accepts ``{"eligibility": str?, "design": {...}?}``. At least one of the two
    keys must be present. Returns ``{"gates": {...}?, "credibility": {...}?}`` with
    only the sections that were requested. Raises ValueError on malformed input.
    """
    if not isinstance(payload, dict):
        raise ValueError("input must be a JSON object with 'eligibility' and/or 'design'")

    has_eligibility = "eligibility" in payload and payload.get("eligibility") is not None
    has_design = "design" in payload and payload.get("design") is not None
    if not has_eligibility and not has_design:
        raise ValueError("provide 'eligibility' text and/or a 'design' object")

    result: dict[str, Any] = {}

    if has_eligibility:
        gates = parse_eligibility(payload.get("eligibility"))
        result["gates"] = {
            "inclusion": gates["inclusion"],
            "exclusion": gates["exclusion"],
            "inclusionCount": len(gates["inclusion"]),
            "exclusionCount": len(gates["exclusion"]),
        }

    if has_design:
        credibility = score_design_credibility(_normalize_design(payload.get("design")))
        result["credibility"] = credibility.to_dict()

    return result


def _read_input(arg: Optional[str]) -> Any:
    text = arg if arg is not None else sys.stdin.read()
    if text is None or text.strip() == "":
        raise ValueError("no input provided on --arg or stdin")
    try:
        return json.loads(text)
    except json.JSONDecodeError as exc:
        raise ValueError(f"input is not valid JSON: {exc}") from exc


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description="PaperTrail eligibility parsing + design-credibility priors "
        "(deterministic, stdlib-only).",
    )
    parser.add_argument(
        "--arg",
        dest="arg",
        default=None,
        help='JSON payload {"eligibility":str?,"design":{...}?}. '
        "If omitted, reads JSON from stdin.",
    )
    args = parser.parse_args(argv)

    try:
        payload = _read_input(args.arg)
        result = analyze_trial_design(payload)
    except ValueError as exc:
        print(json.dumps({"error": str(exc)}))
        return 2

    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
