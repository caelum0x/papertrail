#!/usr/bin/env python3
# PAPERTRAIL-NATIVE NEGATION-AWARE ENTAILMENT — a specialization of the MiniCheck engine,
# owned by PaperTrail (this repo). See PAPERTRAIL.md in this directory.
#
# WHY THIS FILE EXISTS
# --------------------
# MiniCheck (Tang, Laban & Durrett, EMNLP 2024) answers ONE question with a trained model:
# MiniCheck(document, claim) -> {supported, unsupported}. Its shipped prompt
# (minicheck/utils.py SYSTEM_PROMPT) frames it as: "Determine whether the provided claim is
# consistent with the corresponding document. Consistency ... implies that all information
# presented in the claim is substantiated by the document."
#
# That framing has a blind spot PaperTrail must not have: ABSENCE claims. A claim like
# "Drug X does NOT cause hepatotoxicity" is SUPPORTED by a source that shows ABSENCE /
# no-association ("no significant difference in ALT elevation vs placebo"), and REFUTED by a
# source that shows PRESENCE ("Drug X caused dose-dependent hepatotoxicity"). A vanilla
# consistency check conflates these: it treats the source's mention of hepatotoxicity as
# topical overlap and can wrongly call the negative claim "supported" — or, seeing the source
# describe the very effect the claim denies, wrongly call it "refuted". The polarity of the
# claim flips the meaning of every support signal.
#
# PaperTrail's MOAT rule: NO LLM in any scoring / verdict / label path. The polarity of the
# claim and the final label are decided by DETERMINISTIC rules here. The only judgement a
# language model may make is the underlying, polarity-NEUTRAL question — "does the source
# assert the presence of this effect, its absence, or neither?" — and even that must be
# GROUNDED to a verbatim source span (dropped if ungroundable) before it counts.
#
# This file is the Python mirror of the TypeScript contract in
# lib/grounding/negationEntailment.ts. It is DETERMINISTIC end to end: given the neutral
# presence/absence/neither judgement (the model step upstream, passed in here), it decides
# polarity from a negation-cue lexicon and maps (polarity x source_assertion) to a final
# label by a FIXED table — no model, no network. Same input -> same output, always.
#
# LABEL TABLE (polarity x what the source asserts about the effect):
#
#                    | source: PRESENCE | source: ABSENCE     | source: NEITHER
#   -----------------+------------------+---------------------+----------------
#   POSITIVE claim   | supported        | refuted             | nei
#   ("X causes Y")   |                  |                     |
#   -----------------+------------------+---------------------+----------------
#   NEGATIVE claim   | refuted          | negative_supported  | nei
#   ("X does NOT     |                  |                     |
#    cause Y")       |                  |                     |
#
# `negative_supported` is a distinct verdict (not folded into `supported`) so downstream
# consumers can see that an ABSENCE claim was confirmed by evidence of ABSENCE — the honest
# provenance of the answer — rather than a generic "supported".
#
# I/O (argparse): JSON on --json / --arg or on stdin. Prints ONE JSON object to stdout.
#   On bad input: {"error": "..."} to stdout and exit code 2.
#
#   Input JSON:
#     {
#       "claim": "Drug X does not cause hepatotoxicity",   # required, non-empty
#       "source_text": "...full source raw_text...",        # required, non-empty
#       "judgement": {                                       # OPTIONAL neutral model step
#         "source_assertion": "presence" | "absence" | "neither",
#         "confidence": 0.0..1.0,
#         "supporting_sentence": "verbatim source sentence"  # grounded here; dropped if not
#       }
#     }
#
#   When "judgement" is omitted, the module still returns the DETERMINISTIC polarity detection
#   plus a "nei" label (no neutral judgement -> nothing to map), so the polarity detector is
#   independently testable with stdlib only and no upstream model call.
#
#   Output JSON (mirrors VerifyAbsenceResult in lib/grounding/negationEntailment.ts):
#     {
#       "polarity": "positive" | "negative",
#       "negation_cues": ["not", ...],           # cues detected in the claim (evidence)
#       "source_assertion": "presence"|"absence"|"neither"|null,
#       "label": "supported"|"negative_supported"|"refuted"|"nei",
#       "score": 0.0..1.0,                        # neutral judgement confidence; 0 when nei/ungrounded
#       "supporting_span": {                      # verbatim, offset-bearing; null if ungroundable
#         "text": "...", "start": 12, "end": 44, "status": "exact"|"approximate"
#       } | null,
#       "grounding_dropped": true|false           # a supporting_sentence was provided but not located
#     }
#
# This file is standalone: `python papertrail_negation.py --json '{...}'`. It imports only the
# Python standard library, so it runs with no MiniCheck install and no model download. The
# backend/engines directory is excluded from the Next build, so there is zero TypeScript impact.

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass
from typing import Optional

# ---------------------------------------------------------------------------
# NEGATION-CUE LEXICON — the deterministic polarity detector. A claim is NEGATIVE when it
# denies the effect it names. These cues are matched case-insensitively as whole tokens (word
# boundaries), so "notable" does not trip "not" and "cannot" is caught by an explicit entry.
# This lexicon (and its whole-token matching rule) is IDENTICAL to NEGATION_CUES in
# lib/grounding/negationEntailment.ts, so the two implementations agree on polarity exactly.
# ---------------------------------------------------------------------------

NEGATION_CUES: tuple[str, ...] = (
    "not",
    "no",
    "never",
    "none",
    "without",
    "absence of",
    "lack of",
    "lacks",
    "lacking",
    "fails to",
    "failed to",
    "does not",
    "do not",
    "did not",
    "cannot",
    "unable to",
    "no evidence of",
    "no association",
    "not associated",
    "no significant",
    "did not cause",
    "does not cause",
    "no increased risk",
    "not linked",
)

# Source-assertion labels the neutral (grounded) judgement step may emit. Kept as a fixed
# closed set; anything else is rejected as bad input.
VALID_ASSERTIONS: frozenset[str] = frozenset({"presence", "absence", "neither"})


def detect_polarity(claim: str) -> tuple[str, list[str]]:
    """Deterministically classify a claim's polarity from the negation-cue lexicon.

    Returns ("negative", [cues...]) if any whole-token cue is present, else ("positive", []).
    Whole-token matching (word boundaries) so substrings like "notable"/"cannotate" don't
    false-trip. Mirrors detectPolarity() in lib/grounding/negationEntailment.ts.
    """
    lowered = claim.lower()
    found: list[str] = []
    for cue in NEGATION_CUES:
        # Escape the cue and require word boundaries on both sides. Multi-word cues
        # ("absence of") match as a phrase with a boundary before/after the whole phrase.
        pattern = r"(?<!\w)" + re.escape(cue) + r"(?!\w)"
        if re.search(pattern, lowered):
            found.append(cue)
    polarity = "negative" if found else "positive"
    return polarity, found


# ---------------------------------------------------------------------------
# GROUNDING — a stdlib port of lib/grounding.ts locateSpan (Tier 1 exact, Tier 2
# whitespace-normalized with offset map back to the verbatim source substring). A supporting
# sentence that cannot be located in the source is DROPPED: PaperTrail never asserts an
# unsourced span, and an ungroundable "support" is treated as no support.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class LocatedSpan:
    text: str
    start: int
    end: int
    status: str  # "exact" | "approximate"


def _normalize_with_offsets(text: str) -> tuple[str, list[int]]:
    """Whitespace-collapsed copy of `text` plus offsets[i] = index in the ORIGINAL of the
    i-th normalized char. Mirrors normalizeWithOffsets() in lib/grounding.ts."""
    normalized_chars: list[str] = []
    offsets: list[int] = []
    in_whitespace = False
    for i, ch in enumerate(text):
        if ch.isspace():
            if not in_whitespace:
                normalized_chars.append(" ")
                offsets.append(i)
                in_whitespace = True
        else:
            normalized_chars.append(ch)
            offsets.append(i)
            in_whitespace = False
    return "".join(normalized_chars), offsets


def locate_span(raw_text: str, candidate: str) -> Optional[LocatedSpan]:
    """Locate `candidate` inside `raw_text`. Tier 1 exact, Tier 2 whitespace-normalized.
    Returns the VERBATIM source substring (never the candidate/normalized form) with offsets,
    or None if it cannot be located either way. Mirrors locateSpan() in lib/grounding.ts."""
    trimmed = candidate.strip()
    if not trimmed:
        return None

    exact_idx = raw_text.find(trimmed)
    if exact_idx != -1:
        return LocatedSpan(
            text=trimmed, start=exact_idx, end=exact_idx + len(trimmed), status="exact"
        )

    normalized, offsets = _normalize_with_offsets(raw_text)
    norm_candidate = re.sub(r"\s+", " ", trimmed)
    norm_idx = normalized.find(norm_candidate)
    if norm_idx != -1:
        start = offsets[norm_idx]
        last_norm_char = norm_idx + len(norm_candidate) - 1
        end = offsets[last_norm_char] + 1
        return LocatedSpan(
            text=raw_text[start:end], start=start, end=end, status="approximate"
        )

    return None


# ---------------------------------------------------------------------------
# LABEL MAPPING — the FIXED (polarity x source_assertion) -> label table above. This is the
# heart of the moat: no model touches this. Mirrors mapLabel() in
# lib/grounding/negationEntailment.ts.
# ---------------------------------------------------------------------------

_LABEL_TABLE: dict[tuple[str, str], str] = {
    ("positive", "presence"): "supported",
    ("positive", "absence"): "refuted",
    ("positive", "neither"): "nei",
    ("negative", "presence"): "refuted",
    ("negative", "absence"): "negative_supported",
    ("negative", "neither"): "nei",
}


def map_label(polarity: str, source_assertion: str) -> str:
    """Map (claim polarity, what the source asserts) -> final label by the fixed table."""
    return _LABEL_TABLE[(polarity, source_assertion)]


# ---------------------------------------------------------------------------
# CORE — assemble the deterministic result. Optionally consumes the neutral (grounded)
# judgement; grounds its supporting sentence and drops it if ungroundable.
# ---------------------------------------------------------------------------


def verify_absence_claim(payload: dict) -> dict:
    """Deterministically verify an ABSENCE-aware claim against a source.

    `payload` is the validated input dict (see module I/O docstring). Returns the output dict.
    Raises ValueError on structurally-bad input so the CLI can emit {"error"...} + exit 2.
    """
    claim = payload.get("claim")
    source_text = payload.get("source_text")

    if not isinstance(claim, str) or not claim.strip():
        raise ValueError("`claim` must be a non-empty string")
    if not isinstance(source_text, str) or not source_text.strip():
        raise ValueError("`source_text` must be a non-empty string")

    polarity, cues = detect_polarity(claim)

    judgement = payload.get("judgement")

    # No neutral judgement supplied -> honest "nei": we detected polarity but have no grounded
    # presence/absence signal to map. Score 0, no span.
    if judgement is None:
        return {
            "polarity": polarity,
            "negation_cues": cues,
            "source_assertion": None,
            "label": "nei",
            "score": 0.0,
            "supporting_span": None,
            "grounding_dropped": False,
        }

    if not isinstance(judgement, dict):
        raise ValueError("`judgement` must be an object when provided")

    source_assertion = judgement.get("source_assertion")
    if source_assertion not in VALID_ASSERTIONS:
        raise ValueError(
            "`judgement.source_assertion` must be one of 'presence' | 'absence' | 'neither'"
        )

    confidence = judgement.get("confidence", 0.0)
    if not isinstance(confidence, (int, float)) or isinstance(confidence, bool):
        raise ValueError("`judgement.confidence` must be a number in [0, 1]")
    confidence = float(confidence)
    if confidence < 0.0 or confidence > 1.0:
        raise ValueError("`judgement.confidence` must be in [0, 1]")

    supporting_sentence = judgement.get("supporting_sentence", "")
    if not isinstance(supporting_sentence, str):
        raise ValueError("`judgement.supporting_sentence` must be a string")

    label = map_label(polarity, source_assertion)

    # A "neither" assertion is a genuine no-support -> nei, no span to ground, score 0.
    if source_assertion == "neither":
        return {
            "polarity": polarity,
            "negation_cues": cues,
            "source_assertion": source_assertion,
            "label": "nei",
            "score": 0.0,
            "supporting_span": None,
            "grounding_dropped": False,
        }

    # presence / absence: ground the supporting sentence. If it can't be located, the support
    # is ungrounded -> drop the span, downgrade to nei, zero the score (fabricated support).
    located = locate_span(source_text, supporting_sentence)
    if located is None:
        return {
            "polarity": polarity,
            "negation_cues": cues,
            "source_assertion": source_assertion,
            "label": "nei",
            "score": 0.0,
            "supporting_span": None,
            "grounding_dropped": bool(supporting_sentence.strip()),
        }

    return {
        "polarity": polarity,
        "negation_cues": cues,
        "source_assertion": source_assertion,
        "label": label,
        "score": confidence,
        "supporting_span": {
            "text": located.text,
            "start": located.start,
            "end": located.end,
            "status": located.status,
        },
        "grounding_dropped": False,
    }


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def _read_payload(args: argparse.Namespace) -> dict:
    raw = args.json if args.json is not None else args.arg
    if raw is None:
        raw = sys.stdin.read()
    raw = (raw or "").strip()
    if not raw:
        raise ValueError("no input provided (pass --json / --arg or pipe JSON on stdin)")
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError(f"input is not valid JSON: {exc}") from exc
    if not isinstance(parsed, dict):
        raise ValueError("input JSON must be an object")
    return parsed


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description=(
            "PaperTrail-native negation-aware entailment (MiniCheck specialization). "
            "Reads a JSON object on --json/--arg or stdin; prints one JSON object to stdout."
        )
    )
    parser.add_argument("--json", help="input JSON object as a string")
    parser.add_argument("--arg", help="alias for --json")
    args = parser.parse_args(argv)

    try:
        payload = _read_payload(args)
        result = verify_absence_claim(payload)
    except ValueError as exc:
        json.dump({"error": str(exc)}, sys.stdout)
        sys.stdout.write("\n")
        return 2

    json.dump(result, sys.stdout)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
