#!/usr/bin/env python3
"""PaperTrail specialization of lucereal/AutoResearcher — deterministic coverage-GAP gather.

This file is a PaperTrail-native specialization of the AutoResearcher engine (this repo owns
the vendored lucereal/AutoResearcher tree under backend/engines/autoresearcher-lucereal/).
Upstream AutoResearcher generates search queries from a topic and LIVE-fetches papers/abstracts
(and, in some flavours, web/social sources) to gather evidence. PaperTrail's moat rule forbids
that inside orchestration: *TRUSTED biomedical sources only, and NO live fetch / no network in
the verification path.* So this module keeps AutoResearcher's query-generation + coverage-gap
IDEA but turns it into a DETERMINISTIC, OFFLINE analysis over sources the caller already holds.

Given a claim, the key entities it is about, and the sources already gathered, it:
  1. decomposes the claim into per-FACET sub-queries (facet × key entity), and
  2. measures which sub-queries are COVERED by the provided sources vs. which are GAPS.

A gap is NOT a refutation — it means the evidence set does not span a clinical lens the claim
implies (e.g. the claim asserts a mechanism but no source discusses one). The tool votes
`insufficient` when a MAJOR facet is left uncovered and `neutral` otherwise; confidence is the
coverage fraction. There is NO LLM, no randomness, and no network anywhere: same claim + entities
+ sources always yield the same sub-queries and the same coverage map.

**No other file in this engine is modified.** This module is standalone, stdlib-only Python (no
AutoResearcher install, no model download, no network), and this whole directory is excluded from
the Next build — zero TypeScript/build impact. It is the OFFLINE TWIN of the on-demand TS agent
lib/moa/agents/autogather.ts (same facets, same cues, same coverage rule, field-for-field detail).

USAGE (stdlib only, no install):

    # JSON on stdin:
    #   { "claim": str,
    #     "entities": [str, ...]        # key entities (scispaCy surface texts); optional
    #     "sources": [ {"id": str, "text": str, "title"?: str, "rank"?: number,
    #                   "offTopic"?: bool}, ... ] }
    echo '{"claim":"Drug X reduced events by 30%",
           "entities":["Drug X","events"],
           "sources":[{"id":"s1","text":"Drug X reduced events (hazard ratio 0.70)."}]}' \
      | python3 papertrail_gather.py

    # or via --input-file / inline via --arg
    python3 papertrail_gather.py --input-file gather.json
    python3 papertrail_gather.py --arg '{"claim":"...","sources":[...]}'

OUTPUT (stdout, JSON):

    {
      "signal": "neutral" | "insufficient",
      "confidence": <coverage fraction in [0,1]>,
      "subQueries": [ {"facet","entity","major","covered","coveredSourceIds","matchedCue"}, ... ],
      "covered":    [ {"facet","entity"}, ... ],
      "gaps":       [ {"facet","entity","major"}, ... ],
      "totalSubQueries": int, "coveredCount": int, "gapCount": int, "majorGapCount": int,
      "coverageFraction": float,
      "keyEntities": [str, ...], "entitySeedSource": "entities" | "claim_tokens",
      "onTopicSourceCount": int, "droppedOffTopicCount": int
    }

Boundary failure (unreadable/invalid JSON or structurally invalid payload) is reported as
{"error": ...} on stdout with exit code 2 — never a silent crash. usedClaude is always false.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from typing import Any, Dict, List, Optional, Tuple

# ---------------------------------------------------------------------------
# Facets — MUST stay identical to FACETS in lib/moa/agents/autogather.ts so the offline
# Python gather and the on-demand TS agent generate the same sub-queries and measure the
# same coverage from identical inputs. Each facet: (id, major, cues).
# ---------------------------------------------------------------------------

FACETS: Tuple[Tuple[str, bool, Tuple[str, ...]], ...] = (
    (
        "efficacy",
        True,
        (
            "efficacy",
            "effective",
            "reduced",
            "reduction",
            "improved",
            "improvement",
            "response",
            "outcome",
            "endpoint",
            "hazard ratio",
            "relative risk",
            "odds ratio",
            "survival",
        ),
    ),
    (
        "safety",
        False,
        (
            "safety",
            "adverse",
            "toxicity",
            "tolerability",
            "side effect",
            "harm",
            "mortality",
            "serious event",
        ),
    ),
    (
        "mechanism",
        False,
        (
            "mechanism",
            "pathway",
            "receptor",
            "inhibit",
            "inhibition",
            "agonist",
            "antagonist",
            "binding",
            "expression",
            "signaling",
        ),
    ),
    (
        "population",
        False,
        (
            "population",
            "patients",
            "participants",
            "subjects",
            "cohort",
            "subgroup",
            "randomized",
            "randomised",
            "trial",
            "phase",
            "enrolled",
        ),
    ),
)

MAX_KEY_ENTITIES = 6
MAX_DETAIL_IDS = 25

STOP_WORDS = frozenset(
    {
        "the",
        "a",
        "an",
        "of",
        "in",
        "on",
        "by",
        "for",
        "to",
        "and",
        "or",
        "with",
        "was",
        "were",
        "is",
        "are",
        "be",
        "been",
        "that",
        "this",
        "than",
        "from",
        "at",
        "as",
        "it",
        "its",
        "reduced",
        "reduces",
        "increased",
        "increases",
        "percent",
    }
)

_NON_ALNUM = re.compile(r"[^a-z0-9]+")


# ---------------------------------------------------------------------------
# Boundary — validate + normalize the input payload. Drop, never coerce.
# ---------------------------------------------------------------------------


class GatherError(Exception):
    """A structural problem in the input payload (reported as {"error": ...}, exit 2)."""


def _normalize(text: str) -> str:
    """Space-padded, single-spaced, alphanumeric token stream for whole-word matching."""
    collapsed = _NON_ALNUM.sub(" ", text.lower()).strip()
    collapsed = re.sub(r"\s+", " ", collapsed)
    return f" {collapsed} "


def _term_matches(normalized_text: str, term: str) -> bool:
    normalized_term = _NON_ALNUM.sub(" ", term.lower()).strip()
    normalized_term = re.sub(r"\s+", " ", normalized_term)
    if not normalized_term:
        return False
    return f" {normalized_term} " in normalized_text


def _require_str(value: Any, field: str) -> str:
    if not isinstance(value, str):
        raise GatherError(f"'{field}' must be a string")
    return value


def _parse_sources(raw: Any) -> List[Dict[str, Any]]:
    if not isinstance(raw, list):
        raise GatherError("'sources' must be an array")
    sources: List[Dict[str, Any]] = []
    for i, item in enumerate(raw):
        if not isinstance(item, dict):
            raise GatherError(f"sources[{i}] must be an object")
        sid = item.get("id")
        text = item.get("text")
        if not isinstance(sid, str) or not sid:
            raise GatherError(f"sources[{i}].id must be a non-empty string")
        if not isinstance(text, str):
            raise GatherError(f"sources[{i}].text must be a string")
        if not text.strip():
            continue  # unusable text — skip like the TS agent's hasUsableText filter.
        title = item.get("title")
        if title is not None and not isinstance(title, str):
            raise GatherError(f"sources[{i}].title must be a string or absent")
        rank = item.get("rank", 1)
        if not isinstance(rank, (int, float)) or isinstance(rank, bool):
            raise GatherError(f"sources[{i}].rank must be a number")
        rank_val = min(1.0, max(0.0, float(rank)))
        off_topic = item.get("offTopic", False)
        if not isinstance(off_topic, bool):
            raise GatherError(f"sources[{i}].offTopic must be a boolean")
        sources.append(
            {
                "id": sid,
                "title": title or "",
                "text": text,
                "rank": rank_val,
                "offTopic": off_topic,
            }
        )
    return sources


def _parse_entities(raw: Any) -> List[str]:
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise GatherError("'entities' must be an array of strings or absent")
    entities: List[str] = []
    for i, item in enumerate(raw):
        if not isinstance(item, str):
            raise GatherError(f"entities[{i}] must be a string")
        entities.append(item)
    return entities


# ---------------------------------------------------------------------------
# Key entities that seed the per-facet sub-queries (entities first, claim tokens fallback).
# ---------------------------------------------------------------------------


def _key_entities(claim: str, entities: List[str]) -> Tuple[List[str], str]:
    if entities:
        seen: set[str] = set()
        terms: List[str] = []
        for text in entities:
            trimmed = text.strip()
            key = trimmed.lower()
            if not trimmed or key in seen:
                continue
            seen.add(key)
            terms.append(trimmed)
            if len(terms) >= MAX_KEY_ENTITIES:
                break
        if terms:
            return terms, "entities"

    seen2: set[str] = set()
    tokens: List[str] = []
    for raw in _NON_ALNUM.sub(" ", claim.lower()).split():
        if len(raw) < 4 or raw in STOP_WORDS or raw in seen2:
            continue
        seen2.add(raw)
        tokens.append(raw)
        if len(tokens) >= MAX_KEY_ENTITIES:
            break
    return tokens, "claim_tokens"


# ---------------------------------------------------------------------------
# Generate the sub-query grid (facet × entity) and measure coverage over on-topic sources.
# ---------------------------------------------------------------------------


def _generate_and_cover(
    key_terms: List[str], sources: List[Dict[str, Any]]
) -> List[Dict[str, Any]]:
    # Descending relevance rank, stable id tie-break — same order as the TS agent.
    ordered = sorted(sources, key=lambda s: (-s["rank"], s["id"]))
    normalized = [
        {"id": s["id"], "normalized": _normalize(f"{s['title']} {s['text']}")}
        for s in ordered
    ]
    sub_queries: List[Dict[str, Any]] = []
    for facet_id, major, cues in FACETS:
        for entity in key_terms:
            covered_ids: List[str] = []
            matched_cue: Optional[str] = None
            for src in normalized:
                if not _term_matches(src["normalized"], entity):
                    continue
                cue = next((c for c in cues if _term_matches(src["normalized"], c)), None)
                if cue is not None:
                    covered_ids.append(src["id"])
                    if matched_cue is None:
                        matched_cue = cue
            sub_queries.append(
                {
                    "facet": facet_id,
                    "entity": entity,
                    "major": major,
                    "covered": len(covered_ids) > 0,
                    "coveredSourceIds": covered_ids,
                    "matchedCue": matched_cue,
                }
            )
    return sub_queries


def gather(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Run the deterministic coverage-gap analysis. Raises GatherError on invalid input."""
    if not isinstance(payload, dict):
        raise GatherError("input must be a JSON object")

    claim = _require_str(payload.get("claim"), "claim")
    entities = _parse_entities(payload.get("entities"))
    sources = _parse_sources(payload.get("sources"))

    if not sources:
        raise GatherError("'sources' must contain at least one source with usable text")

    on_topic = [s for s in sources if not s["offTopic"]]
    dropped_off_topic = len(sources) - len(on_topic)
    if not on_topic:
        raise GatherError("every source was flagged offTopic — no on-topic evidence to gather over")

    key_terms, entity_seed_source = _key_entities(claim, entities)
    if not key_terms:
        raise GatherError("no key entities or salient claim tokens to seed sub-queries")

    sub_queries = _generate_and_cover(key_terms, on_topic)

    total = len(sub_queries)
    covered = [q for q in sub_queries if q["covered"]]
    gaps = [q for q in sub_queries if not q["covered"]]
    major_gaps = [q for q in gaps if q["major"]]
    coverage_fraction = (len(covered) / total) if total > 0 else 0.0

    signal = "insufficient" if major_gaps else "neutral"

    return {
        "signal": signal,
        "confidence": coverage_fraction,
        "subQueries": [
            {
                "facet": q["facet"],
                "entity": q["entity"],
                "major": q["major"],
                "covered": q["covered"],
                "coveredSourceIds": q["coveredSourceIds"][:MAX_DETAIL_IDS],
                "coveredSourceIdsTruncated": len(q["coveredSourceIds"]) > MAX_DETAIL_IDS,
                "matchedCue": q["matchedCue"],
            }
            for q in sub_queries
        ],
        "covered": [{"facet": q["facet"], "entity": q["entity"]} for q in covered],
        "gaps": [{"facet": q["facet"], "entity": q["entity"], "major": q["major"]} for q in gaps],
        "totalSubQueries": total,
        "coveredCount": len(covered),
        "gapCount": len(gaps),
        "majorGapCount": len(major_gaps),
        "coverageFraction": coverage_fraction,
        "keyEntities": key_terms,
        "entitySeedSource": entity_seed_source,
        "onTopicSourceCount": len(on_topic),
        "droppedOffTopicCount": dropped_off_topic,
        "usedClaude": False,
    }


# ---------------------------------------------------------------------------
# CLI boundary.
# ---------------------------------------------------------------------------


def _read_input(args: argparse.Namespace) -> str:
    if args.arg is not None:
        return args.arg
    if args.input_file is not None:
        with open(args.input_file, "r", encoding="utf-8") as fh:
            return fh.read()
    return sys.stdin.read()


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Deterministic coverage-gap gather over already-held trusted sources (no fetch)."
    )
    parser.add_argument("--arg", type=str, default=None, help="inline JSON payload")
    parser.add_argument("--input-file", type=str, default=None, help="path to a JSON payload file")
    args = parser.parse_args()

    try:
        raw = _read_input(args)
    except OSError as exc:
        print(json.dumps({"error": f"could not read input: {exc}"}))
        return 2

    try:
        payload = json.loads(raw)
    except (json.JSONDecodeError, ValueError) as exc:
        print(json.dumps({"error": f"invalid JSON: {exc}"}))
        return 2

    try:
        result = gather(payload)
    except GatherError as exc:
        print(json.dumps({"error": str(exc)}))
        return 2

    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    sys.exit(main())
