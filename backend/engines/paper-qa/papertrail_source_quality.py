"""PaperTrail specialization of paper-qa: SOURCE-QUALITY TIERS + evidence weight.

paper-qa's answer synthesis treats every retrieved passage as equally trustworthy
once it clears retrieval. PaperTrail cannot: a claim "confirmed" by a retracted paper
or an un-reviewed preprint is not confirmed at all. This module deterministically
assigns each source a QUALITY TIER (A/B/C/D) and a QUALITY WEIGHT in ``[0, 1]`` from
its metadata alone, so downstream synthesis can DOWN-WEIGHT low-tier evidence instead
of counting it at face value.

The rubric is a pure, documented function of the metadata — NO LLM, no network, no
model call anywhere in the scoring path. The same metadata always yields the same
tier and weight, which is exactly what a provenance/verification tool must guarantee.

Tier rubric (evaluated top to bottom; first match wins the CAP):

    Retracted  -> Tier D ("untrusted"), weight 0.0. HARD CAP: a Retraction Watch id
                  (or an explicit ``retracted: true``) forces D regardless of journal,
                  citations, or open-access status. A retracted source can never be
                  used to support a claim.

    Otherwise a BASE tier is chosen from the publication venue:
      - Peer-reviewed journal (a journal name is present and the source is NOT a
        preprint)                          -> base Tier B
      - Preprint (``is_preprint: true``)   -> base Tier C
      - Unknown venue (no journal, not a
        preprint)                          -> base Tier C

    The base tier is then ADJUSTED by corroboration signals:
      - A peer-reviewed journal article that is well cited (citations >=
        ``WELL_CITED_THRESHOLD``) is PROMOTED B -> A (the highest trusted tier).
      - A peer-reviewed journal article with zero recorded citations stays at B (we
        never promote on citations alone, and never demote a real journal below B).
      - A preprint/unknown source with meaningful citations (citations >=
        ``PREPRINT_CITED_THRESHOLD``) is PROMOTED C -> B: sustained citation is
        weak evidence the community has vetted it, but it is still capped at B
        because it was never formally peer reviewed.

    Open access never changes the tier (access model is orthogonal to trust); it is
    reported as a small, transparent additive bonus on the weight only, so an
    open-access source is marginally preferred between two otherwise-equal sources
    (reproducibility), without ever letting access buy a higher tier.

Weight rubric (deterministic, clamped to ``[0, 1]``):

    Base weight by tier:  A -> 1.00, B -> 0.80, C -> 0.50, D -> 0.00
    Open-access bonus:    +0.05 (only for non-D tiers; D stays hard-capped at 0.0)

The weight is the quantity synthesis multiplies an evidence item by, so a Tier-C
preprint contributes half the pooled weight of a Tier-A vetted journal article, and
a retracted source contributes nothing.

Governance: this module handles only source METADATA (journal name, year, integer
citation count, boolean flags, opaque ids) — never claim, source-body, or patient
text — so its JSON output is safe to log.

CLI: reads a JSON object on ``--arg`` or from stdin, prints JSON to stdout. On bad
input it prints ``{"error": ...}`` and exits 2.

    echo '{"sources":[{"id":"s1","journal":"NEJM","citations":300}]}' \\
        | python papertrail_source_quality.py
    python papertrail_source_quality.py --arg '{"sources":[{"id":"s1","retracted":true}]}'
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from typing import Any, Optional

# --- Rubric constants (single source of truth; mirrored in lib/paperqa/sourceQuality.ts) ---

WELL_CITED_THRESHOLD = 100  # journal article citations at/above this promote B -> A
PREPRINT_CITED_THRESHOLD = 50  # preprint/unknown citations at/above this promote C -> B

BASE_WEIGHT_BY_TIER = {
    "A": 1.00,
    "B": 0.80,
    "C": 0.50,
    "D": 0.00,
}
OPEN_ACCESS_BONUS = 0.05  # additive weight bonus for open access on non-D tiers only

TIER_LABEL = {
    "A": "peer-reviewed, well-cited",
    "B": "peer-reviewed",
    "C": "preprint or unreviewed",
    "D": "untrusted",
}


@dataclass(frozen=True)
class SourceMeta:
    """Normalized, defensively-narrowed source metadata (never trusts raw input)."""

    id: str
    journal: Optional[str]
    year: Optional[int]
    citations: int
    is_preprint: bool
    is_open_access: bool
    retracted: bool
    retraction_watch_id: Optional[str]


@dataclass(frozen=True)
class SourceTier:
    """Deterministic tier + weight + human-readable rationale for one source."""

    id: str
    tier: str  # "A" | "B" | "C" | "D"
    weight: float  # clamped to [0, 1]
    retracted: bool
    rationale: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "tier": self.tier,
            "tier_label": TIER_LABEL[self.tier],
            "weight": self.weight,
            "retracted": self.retracted,
            "rationale": self.rationale,
        }


def _as_optional_str(value: Any) -> Optional[str]:
    if isinstance(value, str):
        stripped = value.strip()
        return stripped or None
    return None


def _as_optional_int(value: Any) -> Optional[int]:
    if isinstance(value, bool):  # bool is an int subclass — reject it explicitly
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value == value and value not in (float("inf"), float("-inf")):
        return int(value)
    return None


def _as_nonneg_int(value: Any) -> int:
    n = _as_optional_int(value)
    if n is None or n < 0:
        return 0
    return n


def _as_bool(value: Any) -> bool:
    return value is True


def _clamp01(value: float) -> float:
    if value < 0.0:
        return 0.0
    if value > 1.0:
        return 1.0
    return round(value, 4)


def _normalize_source(raw: Any) -> SourceMeta:
    """Coerce one raw source object into SourceMeta, or raise ValueError."""
    if not isinstance(raw, dict):
        raise ValueError("each source must be a JSON object")

    source_id = _as_optional_str(raw.get("id"))
    if source_id is None:
        raise ValueError("each source requires a non-empty string 'id'")

    retraction_watch_id = _as_optional_str(raw.get("retraction_watch_id"))
    retracted = _as_bool(raw.get("retracted")) or retraction_watch_id is not None

    return SourceMeta(
        id=source_id,
        journal=_as_optional_str(raw.get("journal")),
        year=_as_optional_int(raw.get("year")),
        citations=_as_nonneg_int(raw.get("citations")),
        is_preprint=_as_bool(raw.get("is_preprint")),
        is_open_access=_as_bool(raw.get("is_open_access")),
        retracted=retracted,
        retraction_watch_id=retraction_watch_id,
    )


def score_source(meta: SourceMeta) -> SourceTier:
    """Deterministically tier one source and compute its quality weight.

    Pure function of ``meta`` — no LLM, no I/O. See the module docstring for the
    full rubric. Returns a NEW SourceTier; the input is not mutated.
    """
    # HARD CAP: retracted -> Tier D, weight 0.0, regardless of any other signal.
    if meta.retracted:
        why = (
            f"Retraction Watch id {meta.retraction_watch_id}"
            if meta.retraction_watch_id is not None
            else "flagged retracted"
        )
        return SourceTier(
            id=meta.id,
            tier="D",
            weight=0.0,
            retracted=True,
            rationale=f"Untrusted (Tier D): {why}; a retracted source cannot support a claim.",
        )

    is_peer_reviewed = meta.journal is not None and not meta.is_preprint

    # Choose base tier from venue, then adjust with corroboration signals.
    if is_peer_reviewed:
        if meta.citations >= WELL_CITED_THRESHOLD:
            tier = "A"
            rationale = (
                f"Peer-reviewed journal ({meta.journal}) with {meta.citations} citations "
                f"(>= {WELL_CITED_THRESHOLD}): promoted to Tier A."
            )
        else:
            tier = "B"
            rationale = (
                f"Peer-reviewed journal ({meta.journal}) with {meta.citations} citations: Tier B."
            )
    else:
        venue = "Preprint" if meta.is_preprint else "Unknown venue (no journal metadata)"
        if meta.citations >= PREPRINT_CITED_THRESHOLD:
            tier = "B"
            rationale = (
                f"{venue} but well cited ({meta.citations} >= {PREPRINT_CITED_THRESHOLD}): "
                f"promoted to Tier B; capped there — never formally peer reviewed."
            )
        else:
            tier = "C"
            rationale = (
                f"{venue} with {meta.citations} citations: Tier C (down-weighted, "
                f"unreviewed evidence)."
            )

    weight = BASE_WEIGHT_BY_TIER[tier]
    if meta.is_open_access:
        weight = _clamp01(weight + OPEN_ACCESS_BONUS)
        rationale += " Open-access bonus applied to weight."

    return SourceTier(
        id=meta.id,
        tier=tier,
        weight=_clamp01(weight),
        retracted=False,
        rationale=rationale,
    )


def tier_sources(payload: Any) -> dict[str, Any]:
    """Tier every source in a ``{"sources": [...]}`` payload.

    Returns ``{"tiers": [...], "count": N}``. Raises ValueError on malformed input.
    """
    if not isinstance(payload, dict):
        raise ValueError("input must be a JSON object with a 'sources' array")
    sources = payload.get("sources")
    if not isinstance(sources, list):
        raise ValueError("'sources' must be an array")

    tiers = [score_source(_normalize_source(raw)).to_dict() for raw in sources]
    return {"tiers": tiers, "count": len(tiers)}


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
        description="PaperTrail source-quality tiering (deterministic, stdlib-only).",
    )
    parser.add_argument(
        "--arg",
        dest="arg",
        default=None,
        help="JSON payload {\"sources\":[...]}. If omitted, reads JSON from stdin.",
    )
    args = parser.parse_args(argv)

    try:
        payload = _read_input(args.arg)
        result = tier_sources(payload)
    except ValueError as exc:
        print(json.dumps({"error": str(exc)}))
        return 2

    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
