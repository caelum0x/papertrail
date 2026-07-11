#!/usr/bin/env python3
# PAPERTRAIL-NATIVE CITATION-GROUNDED REVIEW ASSEMBLER — a specialization of the
# autoresearcher engine (eimenhmdt/autoresearcher), owned by PaperTrail (this repo).
# See PAPERTRAIL.md in this directory.
#
# WHY THIS FILE EXISTS
# --------------------
# Upstream autoresearcher runs an LLM-driven loop: generate search queries -> fetch papers
# (OpenAlex / Semantic Scholar) -> feed abstracts to an LLM that writes a literature-review
# answer with inline citations. The review PROSE and the choice of what to cite are both
# decided by the model, over live-fetched abstracts. That is exactly the black box
# PaperTrail's moat forbids on the verdict/attribution path.
#
# PaperTrail borrows the SHAPE — a citation-grounded review that says which sources support
# and which refute, with verbatim citations ordered by credibility — but strips the black
# box. Given a claim plus per-source LABELS (SUPPORTS / REFUTES / NEI) and quality WEIGHTS
# already produced deterministically upstream (by lib/moa/agents/minicheck + paper-qa's
# quality), this file DETERMINISTICALLY:
#   1. keeps only sources whose label is decisive (SUPPORTS / REFUTES) AND that carry a
#      grounded verbatim citation span,
#   2. partitions them into a supporting side and a refuting side,
#   3. orders each side by its source's quality weight (desc), then source id (asc), then
#      input order (asc), truncating to a per-side cap, and
#   4. emits {summary, citations, supporting_count, refuting_count, coverage} — the exact
#      review-skeleton shape the TypeScript agent (lib/moa/agents/autoreview.ts) assembles.
#
# This is the Python mirror of that TS agent: the deterministic cross-check for the hot-path
# TS implementation (prefer native TS on hot paths, Python engine as by-hand cross-check).
# No other file in this engine is modified.
#
# CONTRACT (mirrors lib/moa/agents/autoreview.ts)
# -----------------------------------------------
#   * Deterministic: no model calls, no network. Same input -> same output, always. The one
#     LLM step in the TS agent (connective prose over the ALREADY-selected citations) has no
#     bearing on which sources are cited, how they are ordered, or the coverage number, so it
#     is intentionally absent here — this file computes only the deterministic skeleton.
#   * Every citation is expected to already be a VERBATIM substring of its source, grounded
#     upstream by lib/grounding.locateSpan. This file does not re-ground or invent a quote.
#   * A source cites a direction only when its label is SUPPORTS or REFUTES; NEI / unlabeled
#     sources contribute no citation (mirrors the TS decisive-label filter).
#   * Honest abstention: fewer than two grounded sources -> {"error": ...} + exit 2, matching
#     the TS agent's skippedContribution ("not enough to assemble a review").
#
# I/O (argparse):
#   JSON on stdin, or --json '{...}':
#     { "claim": str,
#       "sources": [ { "id": str,
#                      "label": "SUPPORTS" | "REFUTES" | "NEI",
#                      "weight": float (0..1, optional; default 0.5),
#                      "span": { "text": str, "start": int, "end": int } | null } ] }
#   Prints ONE JSON object to stdout mirroring ResearchBriefFinding + review counts:
#     { "summary", "citations": [ {source_id, side, text, start, end, weight} ],
#       "supporting_count", "refuting_count", "coverage", "labeled_source_count" }
#   On any input error (bad JSON, too few grounded sources): prints {"error": ...} and exits 2.
#
# Standalone: `python papertrail_review.py --json '{...}'`. Imports only the Python standard
# library (no autoresearcher install, no network). This directory is excluded from the Next
# build, so there is zero TypeScript/build impact.

import argparse
import json
import sys
from typing import Dict, List, Optional, Tuple

# Deterministic tuning constants — FIXED and identical to lib/moa/agents/autoreview.ts so the
# Python cross-check and the TS hot path assemble the same review by hand.
MIN_GROUNDED_SOURCES = 2
MAX_CITATIONS_PER_SIDE = 5
DEFAULT_WEIGHT = 0.5  # neutral weight when a source has no quality entry (mirrors the TS agent).

DECISIVE_LABELS = ("SUPPORTS", "REFUTES")


def _clamp01(value: float) -> float:
    """Clamp a number into [0, 1]; NaN -> 0. Mirrors clamp01 in lib/moa/types.ts."""
    try:
        n = float(value)
    except (TypeError, ValueError):
        return 0.0
    if n != n:  # NaN
        return 0.0
    if n < 0.0:
        return 0.0
    if n > 1.0:
        return 1.0
    return n


def _grounded_span(raw: object) -> Optional[Dict[str, object]]:
    """A citation is groundable only when it carries a non-empty verbatim text plus integer
    offsets. Returns the normalized span dict, or None (dropped) — this file never invents a
    quote, mirroring the TS agent's drop-ungroundable rule."""
    if not isinstance(raw, dict):
        return None
    text = raw.get("text")
    start = raw.get("start")
    end = raw.get("end")
    if not isinstance(text, str) or not text.strip():
        return None
    if not isinstance(start, int) or not isinstance(end, int):
        return None
    return {"text": text, "start": start, "end": end}


def _candidates(sources: List[dict]) -> List[dict]:
    """Build grounded citation candidates from the decisive-labeled sources, preserving input
    order for stable ranking. Drops NEI / unlabeled / ungroundable sources."""
    out: List[dict] = []
    for order, s in enumerate(sources):
        if not isinstance(s, dict):
            continue
        label = s.get("label")
        if label not in DECISIVE_LABELS:
            continue
        span = _grounded_span(s.get("span"))
        if span is None:
            continue
        source_id = str(s.get("id", "")).strip()
        if not source_id:
            continue
        weight = s.get("weight", DEFAULT_WEIGHT)
        out.append(
            {
                "source_id": source_id,
                "side": "SUPPORTS" if label == "SUPPORTS" else "REFUTES",
                "weight": _clamp01(weight if weight is not None else DEFAULT_WEIGHT),
                "order": order,
                "span": span,
            }
        )
    return out


def _order_side(candidates: List[dict], side: str) -> List[dict]:
    """Order one side by quality weight (desc), then source id (asc), then input order (asc),
    truncated to the per-side cap. Deterministic; mirrors orderSide() in the TS agent."""
    side_candidates = [c for c in candidates if c["side"] == side]
    side_candidates.sort(key=lambda c: (-c["weight"], c["source_id"], c["order"]))
    return side_candidates[:MAX_CITATIONS_PER_SIDE]


def _deterministic_summary(supporting_count: int, refuting_count: int) -> str:
    """The deterministic one-line review summary from the grounded counts alone — the safe
    fallback (and the seed the TS agent's optional prose step is allowed to rewrite)."""
    if supporting_count > 0 and refuting_count > 0:
        return (
            "Citation-grounded review: "
            f"{supporting_count} source(s) support and {refuting_count} refute the claim, "
            "ordered by source quality."
        )
    if supporting_count > 0:
        return (
            "Citation-grounded review: "
            f"{supporting_count} source(s) support the claim, ordered by source quality."
        )
    return (
        "Citation-grounded review: "
        f"{refuting_count} source(s) refute the claim, ordered by source quality."
    )


def assemble_review(payload: dict) -> Tuple[Optional[dict], Optional[str]]:
    """Top-level entry — assemble the deterministic review skeleton. Returns (result, None) on
    success or (None, error_message) for honest abstention. Mirrors run() in autoreview.ts."""
    sources = payload.get("sources", [])
    if not isinstance(sources, list):
        sources = []

    labeled_count = sum(
        1
        for s in sources
        if isinstance(s, dict) and s.get("label") in DECISIVE_LABELS
    )

    candidates = _candidates(sources)
    distinct_sources = {c["source_id"] for c in candidates}
    if len(distinct_sources) < MIN_GROUNDED_SOURCES:
        return (
            None,
            "Fewer than two sources carry a grounded supporting/refuting citation; "
            "not enough to assemble a review.",
        )

    supporting = _order_side(candidates, "SUPPORTS")
    refuting = _order_side(candidates, "REFUTES")
    selected = supporting + refuting

    coverage = (
        _clamp01(len(distinct_sources) / labeled_count) if labeled_count > 0 else 0.0
    )
    summary = _deterministic_summary(len(supporting), len(refuting))

    citations = [
        {
            "source_id": c["source_id"],
            "side": c["side"],
            "text": c["span"]["text"],
            "start": c["span"]["start"],
            "end": c["span"]["end"],
            "weight": round(c["weight"], 4),
        }
        for c in selected
    ]

    return (
        {
            "summary": summary,
            "citations": citations,
            "supporting_count": len(supporting),
            "refuting_count": len(refuting),
            "coverage": round(coverage, 4),
            "labeled_source_count": labeled_count,
            "grounded_source_count": len(distinct_sources),
        },
        None,
    )


def _read_payload(args: argparse.Namespace) -> dict:
    if args.json:
        return json.loads(args.json)
    data = sys.stdin.read()
    if not data.strip():
        return {"claim": "", "sources": []}
    return json.loads(data)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="PaperTrail deterministic citation-grounded review assembler "
        "(autoresearcher specialization)."
    )
    parser.add_argument("--json", type=str, default=None, help="Inline JSON payload.")
    args = parser.parse_args()

    try:
        payload = _read_payload(args)
    except json.JSONDecodeError as exc:
        print(json.dumps({"error": f"invalid JSON payload: {exc}"}))
        return 2

    if not isinstance(payload, dict):
        print(json.dumps({"error": "payload must be a JSON object"}))
        return 2

    result, error = assemble_review(payload)
    if error is not None:
        print(json.dumps({"error": error}))
        return 2

    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
