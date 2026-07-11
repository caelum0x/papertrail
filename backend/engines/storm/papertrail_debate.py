#!/usr/bin/env python3
"""PaperTrail specialization of STORM — a deterministic STRUCTURED-DEBATE assembler.

This file is a PaperTrail-native specialization of the STORM engine (this repo owns
the vendored STORM tree under backend/engines/storm/). Upstream STORM runs a
multi-perspective, LLM-driven "conversation" between a writer and simulated experts
(knowledge_storm/interface.py: Conversation; storm_wiki/modules/knowledge_curation.py)
to research a topic before writing. PaperTrail borrows STORM's *shape* — a
multi-perspective debate — but strips the black box: for a MIXED verdict (some sources
support a claim, some refute it), this module deterministically ORGANIZES the provided
evidence into a four-part debate skeleton. It ORGANIZES; it does NOT invent.

**No other file in this engine is modified.** This module is standalone Python with NO
third-party imports (no dspy, no torch, no STORM install, no network), and this whole
directory is excluded from the Next build — zero TypeScript/build impact.

The debate skeleton has four fixed sections, mirroring how a translational-research lab
would adjudicate a contested efficacy claim:

  1. CLAIM            — the claim under scrutiny, verbatim.
  2. BEST_CASE_FOR    — the strongest supporting evidence, ranked (the "proponent").
  3. CRITIQUE         — the strongest refuting evidence, ranked (the "critic").
  4. SYNTHESIS        — a DETERMINISTIC stance computed from the counts/weights alone
                        (mixed / leans_supported / leans_refuted / balanced). No prose,
                        no verdict, and no number is invented here — this file only
                        counts and orders what it was given.

MOAT / determinism guarantees:
  * Every quote in the output is a substring the caller PROVIDED; nothing is paraphrased
    or fabricated. (The TypeScript mirror additionally GROUNDS each quote against the
    real source text via lib/grounding.locateSpan and DROPS ungroundable ones — this
    stdlib module trusts its already-vetted snippet inputs and focuses on the ordering.)
  * Ranking is by a deterministic evidence-strength heuristic (see `_score_snippet`),
    tie-broken by id then by original order — the same input always yields the same
    debate, byte-for-byte. There is NO LLM anywhere in the numbers, the ranking, or the
    synthesis stance. Claude only ever writes the connective prose in the TS mirror; it
    never decides a stance here or there.
  * Honest insufficiency over a forced answer: if there is no supporting OR no refuting
    evidence, the stance is reported as `one_sided` / `insufficient` rather than pretending
    a debate exists.

USAGE (stdlib only, no install):

    # JSON on stdin: {"claim": "...", "supporting": [{"id","text"}], "refuting": [...]}.
    echo '{"claim":"Drug X cut events 30%",
           "supporting":[{"id":"s1","text":"events fell by 30% (p<0.001)"}],
           "refuting":[{"id":"r1","text":"no significant difference was observed"}]}' \
      | python3 papertrail_debate.py

    # or via --input-file
    python3 papertrail_debate.py --input-file debate.json

OUTPUT (stdout, JSON) — the structured debate skeleton. See PAPERTRAIL.md for the
field-for-field mapping to lib/synthesis/debate.ts (buildDebate):

    {
      "claim": "...",
      "sections": {
        "claim":        {"kind":"claim", "text":"..."},
        "best_case_for":{"kind":"best_case_for", "quotes":[{"id","text","rank","score"}]},
        "critique":     {"kind":"critique",      "quotes":[{"id","text","rank","score"}]},
        "synthesis":    {"kind":"synthesis", "stance":"mixed", "supporting_count":N,
                         "refuting_count":M, "margin":D}
      },
      "supporting_count": N, "refuting_count": M, "dropped_empty": K
    }

On unreadable/invalid input this prints {"error": ...} to stdout and exits 2.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from typing import Dict, List, Optional, Tuple

# ---------------------------------------------------------------------------
# Ranking constants — MUST stay identical to lib/synthesis/debate.ts so the Python
# assembler and the TypeScript mirror order the same evidence the same way.
# ---------------------------------------------------------------------------

MAX_QUOTES_PER_SIDE = 5          # cap the debate skeleton; keeps it demo-legible
STANCE_MARGIN_THRESHOLD = 2      # |supporting - refuting| >= this ⇒ a "leans_*" stance

# A deterministic evidence-strength heuristic. Snippets that carry the hallmarks of a
# concrete quantitative finding (p-values, confidence intervals, effect sizes, ratios)
# outrank vague prose. These are keyword/pattern signals only — NO model, NO learning.
_STAT_PATTERNS: Tuple[Tuple[str, float], ...] = (
    (r"p\s*[<=>]\s*0?\.\d+", 3.0),           # p-value, e.g. p<0.001
    (r"\b95%\s*ci\b", 2.5),                  # confidence interval
    (r"\bconfidence interval\b", 2.5),
    (r"\bhazard ratio\b|\bhr\b", 2.0),       # hazard ratio
    (r"\bodds ratio\b|\bor\b", 2.0),         # odds ratio
    (r"\brelative risk\b|\brr\b", 2.0),
    (r"\bn\s*=\s*\d+", 1.5),                 # sample size
    (r"\d+(\.\d+)?\s*%", 1.0),               # any percentage
    (r"\bsignificant\b", 0.75),              # explicit significance language
)


def _score_snippet(text: str) -> float:
    """Deterministic evidence-strength score for one snippet.

    Higher = a stronger, more quantitative piece of evidence. Purely pattern-based:
    a fixed base weight from the snippet's length (longer, more specific quotes edge out
    one-liners) plus fixed bonuses for statistical hallmarks. Reproducible; no LLM.
    """
    lowered = text.lower()
    score = 0.0
    for pattern, weight in _STAT_PATTERNS:
        if re.search(pattern, lowered):
            score += weight
    # Length signal, capped, so a long vague paragraph never beats a crisp statistic.
    word_count = len(text.split())
    score += min(word_count, 40) / 40.0
    return round(score, 6)


class _Snippet:
    """One piece of evidence with a stable id and its deterministic strength score."""

    __slots__ = ("id", "text", "order", "score")

    def __init__(self, snippet_id: str, text: str, order: int) -> None:
        self.id = snippet_id
        self.text = text
        self.order = order
        self.score = _score_snippet(text)

    def sort_key(self) -> Tuple[float, str, int]:
        # Descending score, then ascending id, then original order — fully deterministic.
        return (-self.score, self.id, self.order)


def _rank_side(snippets: List[_Snippet], limit: int) -> List[Dict[str, object]]:
    """Rank one side of the debate and shape it as output quote objects.

    Sorted by the deterministic key, truncated to `limit`, and annotated with a 1-based
    rank. Returns a NEW list of plain dicts; inputs are not mutated.
    """
    ordered = sorted(snippets, key=lambda s: s.sort_key())[:limit]
    quotes: List[Dict[str, object]] = []
    for i, snip in enumerate(ordered):
        quotes.append(
            {
                "id": snip.id,
                "text": snip.text,
                "rank": i + 1,
                "score": snip.score,
            }
        )
    return quotes


def _compute_stance(supporting_count: int, refuting_count: int) -> str:
    """Deterministic synthesis stance from the counts alone — NO LLM, NO invention.

    * one side empty  → "one_sided"      (there is no debate to synthesize)
    * both empty      → "insufficient"   (nothing was provided)
    * |diff| >= threshold, more support  → "leans_supported"
    * |diff| >= threshold, more refute   → "leans_refuted"
    * otherwise                          → "balanced_mixed"
    """
    if supporting_count == 0 and refuting_count == 0:
        return "insufficient"
    if supporting_count == 0 or refuting_count == 0:
        return "one_sided"
    margin = supporting_count - refuting_count
    if margin >= STANCE_MARGIN_THRESHOLD:
        return "leans_supported"
    if -margin >= STANCE_MARGIN_THRESHOLD:
        return "leans_refuted"
    return "balanced_mixed"


def build_debate(
    claim: str,
    supporting: List[_Snippet],
    refuting: List[_Snippet],
) -> Dict[str, object]:
    """Assemble the four-part debate skeleton deterministically. Mirrors buildDebate().

    ORGANIZES the provided evidence — it does not invent. Returns the structured debate
    with ranked best-case-for / critique quotes and a computed synthesis stance.
    """
    best_case_for = _rank_side(supporting, MAX_QUOTES_PER_SIDE)
    critique = _rank_side(refuting, MAX_QUOTES_PER_SIDE)

    supporting_count = len(supporting)
    refuting_count = len(refuting)
    stance = _compute_stance(supporting_count, refuting_count)
    margin = supporting_count - refuting_count

    return {
        "claim": claim,
        "sections": {
            "claim": {"kind": "claim", "text": claim},
            "best_case_for": {"kind": "best_case_for", "quotes": best_case_for},
            "critique": {"kind": "critique", "quotes": critique},
            "synthesis": {
                "kind": "synthesis",
                "stance": stance,
                "supporting_count": supporting_count,
                "refuting_count": refuting_count,
                "margin": margin,
            },
        },
        "supporting_count": supporting_count,
        "refuting_count": refuting_count,
    }


def _parse_side(raw: object) -> Tuple[List[_Snippet], int]:
    """Validate + normalize one side's snippet list.

    Accepts a JSON list of objects with keys id/text. A snippet with an empty/whitespace
    text is DROPPED (honest omission over a fabricated quote); the count of dropped empties
    is returned so the caller can report it. A snippet without an id gets a stable
    positional id. Raises ValueError if `raw` is not a list.
    """
    if not isinstance(raw, list):
        raise ValueError("supporting/refuting must each be a JSON array of snippets")
    snippets: List[_Snippet] = []
    dropped_empty = 0
    for order, item in enumerate(raw):
        if not isinstance(item, dict):
            dropped_empty += 1
            continue
        text = item.get("text")
        if not isinstance(text, str) or text.strip() == "":
            dropped_empty += 1
            continue
        raw_id = item.get("id")
        snippet_id = raw_id if isinstance(raw_id, str) and raw_id != "" else f"#{order}"
        snippets.append(_Snippet(snippet_id, text, order))
    return snippets, dropped_empty


def _parse_input(
    raw: object,
) -> Tuple[str, List[_Snippet], List[_Snippet], int]:
    """Validate the full debate request. Returns (claim, supporting, refuting, dropped)."""
    if not isinstance(raw, dict):
        raise ValueError("input must be a JSON object")
    claim = raw.get("claim")
    if not isinstance(claim, str) or claim.strip() == "":
        raise ValueError("claim must be a non-empty string")
    supporting, dropped_s = _parse_side(raw.get("supporting", []))
    refuting, dropped_r = _parse_side(raw.get("refuting", []))
    return claim.strip(), supporting, refuting, dropped_s + dropped_r


def main(argv: List[str]) -> int:
    parser = argparse.ArgumentParser(
        description="Deterministic structured-debate assembler for MIXED verdicts (PaperTrail)."
    )
    parser.add_argument(
        "--input-file",
        help="Path to a JSON file with the debate request; if omitted, read from stdin.",
    )
    args = parser.parse_args(argv)

    raw: object
    try:
        if args.input_file:
            with open(args.input_file, "r", encoding="utf-8") as handle:
                raw = json.load(handle)
        else:
            raw = json.load(sys.stdin)
    except (OSError, json.JSONDecodeError) as exc:
        json.dump({"error": f"could not read debate input: {exc}"}, sys.stdout)
        sys.stdout.write("\n")
        return 2

    try:
        claim, supporting, refuting, dropped_empty = _parse_input(raw)
    except ValueError as exc:
        json.dump({"error": str(exc)}, sys.stdout)
        sys.stdout.write("\n")
        return 2

    debate = build_debate(claim, supporting, refuting)
    debate["dropped_empty"] = dropped_empty

    json.dump(debate, sys.stdout)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
