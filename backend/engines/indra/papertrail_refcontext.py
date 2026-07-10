#!/usr/bin/env python3
# PAPERTRAIL-NATIVE INDRA RefContext EXTRACTOR — a specialization of the INDRA engine,
# owned by PaperTrail (this repo). See PAPERTRAIL.md in this directory.
#
# WHY THIS FILE EXISTS
# --------------------
# INDRA attaches a `BioContext` (indra/statements/context.py) to every Statement's
# Evidence, built from `RefContext` slots: location / cell_line / cell_type / organ /
# disease / species. Those slots normally live INSIDE INDRA's assembly and are only ever
# resolved to a normalized TISSUE / SPECIES / ASSAY bucket by ad-hoc downstream code.
#
# PaperTrail's context-aware mechanism feature (lib/mechanism/context.ts) needs exactly
# that normalization to DE-RISK preclinical->human translation: a mechanism observed in
# human in-vivo extrapolates far better than one seen in a mouse or a dish. This file is
# the Python mirror of lib/mechanism/context.ts's deterministic classifiers + translation
# score, operating on native INDRA RefContext dicts.
#
# It does two deterministic things, with NO LLM:
#   1. RESOLVE a BioContext's RefContext slots into a normalized MechanismContext:
#        tissue  (free-text UBERON-ish surface term, from cell_type/cell_line/organ),
#        species (NCBI-taxon bucket: human / mouse / rat / in-vitro),
#        assay   (OBI-ish bucket: in-vivo / in-vitro / cell-line).
#      A slot with no grounded name is DROPPED (never assert an ungrounded context),
#      mirroring PaperTrail's "drop the ungroundable" rule.
#   2. SCORE a DETERMINISTIC translation confidence in [0, 1] from the resolved context
#      alone (human in-vivo > animal in-vivo > in-vitro), as the product of a species
#      factor and an assay factor drawn from documented constant tables. NO LLM number is
#      load-bearing — same context -> same score, always.
#
# This is the Python mirror of what lib/mechanism/context.ts computes
# (classifySpecies / classifyAssay / translationConfidence / resolveContext). No other
# file in this engine is modified.
#
# CONTRACT (mirrors lib/mechanism/schemas.ts MechanismContext + translationConfidence)
# ------------------------------------------------------------------------------------
#   * Deterministic: no model calls, no network. Same input -> same output, always.
#   * Species / assay are decided by documented surface-term RULES, never by a model.
#   * A slot with no grounded name is DROPPED; unresolved species/assay stays null (honest
#     "unknown" over a forced bucket).
#   * Honest empty: a context with no grounded slots yields tissue/species/assay = null and
#     the conservative unknown-unknown translation score.
#
# I/O (argparse):
#   JSON on stdin, or --json '{...}':
#     { "contexts": [ { "cell_type"?, "cell_line"?, "organ"?, "species"?, "location"?,
#                       "disease"? } ] }
#     (each slot is either a plain string name, or an INDRA RefContext dict
#      {"name": str, "db_refs": {...}})
#   Prints ONE JSON object:
#     { "contexts": [ { "tissue": str|null, "species": str|null, "assay": str|null,
#                       "translation_confidence": float,
#                       "tags": [ { "kind", "value", "db_refs" } ] } ] }
#
# Standalone: `python papertrail_refcontext.py --json '{...}'`. Imports only the Python
# standard library, so it runs with no INDRA install and no network. This directory is
# excluded from the Next build, so there is zero TypeScript impact.

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass, field
from typing import Any, Optional

# ---------------------------------------------------------------------------
# Documented translation factors — the Python mirror of SPECIES_CONFIDENCE /
# ASSAY_CONFIDENCE in lib/mechanism/schemas.ts. FIXED constants (not tuned, not
# model-derived), so an auditor can re-derive any translation score by hand.
# ---------------------------------------------------------------------------

SPECIES_CONFIDENCE: dict[str, float] = {
    "human": 1.0,
    "rat": 0.6,
    "mouse": 0.6,
    "in-vitro": 0.3,
    "unknown": 0.2,
}

ASSAY_CONFIDENCE: dict[str, float] = {
    "in-vivo": 1.0,
    "cell-line": 0.5,
    "in-vitro": 0.4,
    "unknown": 0.3,
}

# ---------------------------------------------------------------------------
# Surface-term rule tables — mirror lib/mechanism/context.ts. Documented, ordered.
# ---------------------------------------------------------------------------

_HUMAN_TERMS = (
    "human", "humans", "patient", "patients", "homo sapiens",
    "clinical", "subjects", "participants", "men", "women",
)
_MOUSE_TERMS = ("mouse", "mice", "murine", "mus musculus")
_RAT_TERMS = ("rat", "rats", "rattus")
_IN_VITRO_SPECIES_TERMS = (
    "in vitro", "cell line", "cell-line", "cultured", "culture",
    "hek293", "hela", "cell culture",
)

_IN_VIVO_TERMS = (
    "in vivo", "in-vivo", "animal", "mouse", "mice", "rat",
    "patient", "clinical", "murine",
)
_CELL_LINE_TERMS = ("cell line", "cell-line", "hek293", "hela", "immortalized", "cultured line")
_IN_VITRO_ASSAY_TERMS = (
    "in vitro", "in-vitro", "cultured", "culture", "cell culture",
    "biochemical", "reconstituted",
)


def _includes_any(haystack: str, needles: tuple[str, ...]) -> bool:
    return any(n in haystack for n in needles)


def classify_species(surface: str) -> Optional[str]:
    """Resolve a normalized species from a grounded surface term (NCBI-taxon-ish).

    Returns None when the term matches no known bucket — an unresolved tag is dropped
    rather than forced. Order: an explicit organism wins over the in-vitro fallback.
    """
    s = surface.strip().lower()
    if not s:
        return None
    if _includes_any(s, _HUMAN_TERMS):
        return "human"
    if _includes_any(s, _MOUSE_TERMS):
        return "mouse"
    if _includes_any(s, _RAT_TERMS):
        return "rat"
    if _includes_any(s, _IN_VITRO_SPECIES_TERMS):
        return "in-vitro"
    return None


def classify_assay(surface: str) -> Optional[str]:
    """Resolve a normalized assay/system from a grounded surface term (OBI-ish).

    Returns None when the term matches no known bucket. Cell line is a more specific
    in-vitro subtype, so it is checked before the generic in-vitro/in-vivo buckets.
    """
    s = surface.strip().lower()
    if not s:
        return None
    if _includes_any(s, _CELL_LINE_TERMS):
        return "cell-line"
    if _includes_any(s, _IN_VITRO_ASSAY_TERMS):
        return "in-vitro"
    if _includes_any(s, _IN_VIVO_TERMS):
        return "in-vivo"
    return None


def translation_confidence(species: Optional[str], assay: Optional[str]) -> float:
    """Deterministic translation confidence in [0, 1].

    human in-vivo > animal in-vivo > in-vitro / cell-line > unknown. The product of a
    species factor and an assay factor from the documented tables. No LLM number enters.
    """
    species_factor = SPECIES_CONFIDENCE.get(species or "unknown", SPECIES_CONFIDENCE["unknown"])
    assay_factor = ASSAY_CONFIDENCE.get(assay or "unknown", ASSAY_CONFIDENCE["unknown"])
    return round(species_factor * assay_factor, 4)


# ---------------------------------------------------------------------------
# Slot extraction — normalize an INDRA RefContext slot (plain string OR
# {"name", "db_refs"}) into a (name, db_refs) pair. A slot with no grounded name is
# dropped (returns None) — never assert an ungrounded context.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class GroundedTag:
    kind: str  # "tissue" | "species" | "assay"
    value: str
    db_refs: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {"kind": self.kind, "value": self.value, "db_refs": self.db_refs}


def _slot_name_and_refs(slot: Any) -> Optional[tuple[str, dict[str, Any]]]:
    if slot is None:
        return None
    if isinstance(slot, str):
        name = slot.strip()
        return (name, {}) if name else None
    if isinstance(slot, dict):
        raw_name = slot.get("name")
        if not isinstance(raw_name, str):
            return None
        name = raw_name.strip()
        if not name:
            return None
        db_refs = slot.get("db_refs")
        return (name, db_refs if isinstance(db_refs, dict) else {})
    return None


# INDRA RefContext slots that describe TISSUE, in priority order (most specific first).
_TISSUE_SLOTS = ("cell_type", "cell_line", "organ", "location")
# Slots that describe the ORGANISM.
_SPECIES_SLOTS = ("species",)
# Slots whose surface terms hint at the ASSAY/SYSTEM (in-vitro-ish slots + species terms).
_ASSAY_SLOTS = ("cell_line", "cell_type", "organ", "species", "location")


@dataclass(frozen=True)
class ResolvedContext:
    tissue: Optional[str]
    species: Optional[str]
    assay: Optional[str]
    translation_confidence: float
    tags: tuple[GroundedTag, ...]

    def to_dict(self) -> dict[str, Any]:
        return {
            "tissue": self.tissue,
            "species": self.species,
            "assay": self.assay,
            "translation_confidence": self.translation_confidence,
            "tags": [t.to_dict() for t in self.tags],
        }


def resolve_context(context: dict[str, Any]) -> ResolvedContext:
    """Fold an INDRA-style RefContext dict into a normalized MechanismContext.

    Mirrors resolveContext() in lib/mechanism/context.ts: tissue is the first grounded
    tissue-slot surface term; species/assay are the first grounded term a deterministic
    classifier accepts. When no explicit assay resolves, an organism species implies
    in-vivo and an in-vitro species implies in-vitro (documented inference, not a guess).
    """
    tags: list[GroundedTag] = []

    # Tissue — free-text UBERON-ish surface term from the first grounded tissue slot.
    tissue: Optional[str] = None
    for slot_key in _TISSUE_SLOTS:
        resolved = _slot_name_and_refs(context.get(slot_key))
        if resolved is None:
            continue
        name, db_refs = resolved
        tags.append(GroundedTag(kind="tissue", value=name, db_refs=db_refs))
        if tissue is None:
            tissue = name

    # Species — first grounded slot term the classifier accepts.
    species: Optional[str] = None
    for slot_key in _SPECIES_SLOTS:
        resolved = _slot_name_and_refs(context.get(slot_key))
        if resolved is None:
            continue
        name, db_refs = resolved
        tags.append(GroundedTag(kind="species", value=name, db_refs=db_refs))
        if species is None:
            species = classify_species(name)

    # Assay — first grounded slot term the classifier accepts, across the assay-hinting slots.
    assay: Optional[str] = None
    for slot_key in _ASSAY_SLOTS:
        resolved = _slot_name_and_refs(context.get(slot_key))
        if resolved is None:
            continue
        name, _ = resolved
        candidate = classify_assay(name)
        if candidate is not None and assay is None:
            assay = candidate

    # Deterministic inference when no explicit assay resolved.
    if assay is None:
        if species == "in-vitro":
            assay = "in-vitro"
        elif species in ("human", "mouse", "rat"):
            assay = "in-vivo"

    return ResolvedContext(
        tissue=tissue,
        species=species,
        assay=assay,
        translation_confidence=translation_confidence(species, assay),
        tags=tuple(tags),
    )


def resolve_contexts(payload: dict[str, Any]) -> dict[str, Any]:
    raw_contexts = payload.get("contexts")
    contexts = raw_contexts if isinstance(raw_contexts, list) else []
    resolved = [
        resolve_context(c).to_dict()
        for c in contexts
        if isinstance(c, dict)
    ]
    return {"contexts": resolved}


def _read_payload(arg_json: Optional[str]) -> dict[str, Any]:
    raw = arg_json if arg_json is not None else sys.stdin.read()
    if not raw.strip():
        return {"contexts": []}
    parsed = json.loads(raw)
    return parsed if isinstance(parsed, dict) else {"contexts": []}


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Deterministic INDRA RefContext -> normalized tissue/species/assay "
        "+ translation-confidence (PaperTrail specialization; no LLM)."
    )
    parser.add_argument("--json", dest="json_arg", default=None, help="Inline JSON payload.")
    args = parser.parse_args()

    try:
        payload = _read_payload(args.json_arg)
    except json.JSONDecodeError as exc:
        print(json.dumps({"error": f"invalid JSON: {exc}"}))
        return 1

    result = resolve_contexts(payload)
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
