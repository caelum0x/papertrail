#!/usr/bin/env python3
"""PaperTrail-native specialization of R2R: biomedical RAG-Fusion.

This file is a **PaperTrail-native specialization** of the R2R engine. This repo
owns the vendored R2R tree; rather than fork or fight the upstream retrieval
pipeline, we add ONE standalone file that re-implements the *deterministic core*
of R2R's query-decomposition + Reciprocal-Rank-Fusion (RRF) in a way that:

  * satisfies PaperTrail's moat rules (NO LLM in any ranking/fusion path — the
    fusion arithmetic is pure and deterministic), and
  * mirrors the TypeScript contract in `lib/retrieval/hybrid.ts`
    (`fuseRankings` / `ragFusionRetrieve`) field-for-field, so the Python side is
    an auditable reference for the production TS path.

**No other file in this engine is modified.** `papertrail_rag_fusion.py` is
standalone, **stdlib-only** Python (no R2R install, no model download, no
network), and this whole `backend/engines/` tree is excluded from the Next build —
so there is zero TypeScript/build impact.

Why it exists
-------------
Upstream R2R runs a hybrid search that fuses a dense (vector) and a sparse
(full-text) ranking with RRF (see
`py/core/providers/database/chunks.py::hybrid_search`). RAG-Fusion generalizes
that: instead of fusing two *rankers* over ONE query, it decomposes a query into
several sub-queries, retrieves for each, and fuses the several *result lists*
with the same RRF math. The extra lift comes from covering facets of a question a
single embedding would blur together.

For biomedical claims, the useful facets are fixed and clinically meaningful:

    efficacy | safety | mechanism | subgroup

so we decompose DETERMINISTICALLY (a fixed, auditable template per facet) rather
than asking an LLM to invent sub-queries. Same input query -> same facets, always.

The fusion (`reciprocal_rank_fusion`) is a verbatim port of R2R's fusion loop:
each list contributes ``weight / (rrf_k + rank)`` to a document's fused score,
ranks are 1-indexed, and ties break stably on document id so ordering is
identical across runs and platforms.

PaperTrail invariants it enforces
---------------------------------
* **Deterministic** — no model calls, no network, no randomness. Same input ->
  same output, always. The decomposition is a fixed template; the fusion is pure
  arithmetic over integer ranks.
* **Provenance on every fused hit** — each hit records which facets ranked it and
  at what rank, so a reviewer can see *why* a source surfaced.
* **Honest empty** — an empty query, or facets that all retrieve nothing, yields
  an empty result rather than a fabricated hit.

How to invoke (stdlib only, no install)
---------------------------------------
    # 1. Decompose a query into biomedical facets (JSON on stdout):
    echo "Drug X reduced cardiovascular events by 30% in elderly diabetics" \
      | python3 papertrail_rag_fusion.py --decompose

    # 2. Fuse pre-retrieved per-facet ranked id lists with RRF. Input is a JSON
    #    object mapping facet -> ordered id list (best first); output is the fused
    #    ranking with per-facet provenance.
    python3 papertrail_rag_fusion.py --fuse \
      --lists '{"efficacy":["a","b","c"],"safety":["b","d"],"mechanism":["c"]}'

    # 3. End-to-end demo over an in-memory corpus (no DB): decompose, keyword-rank
    #    each facet over the corpus, and fuse. Proves the full shape offline.
    python3 papertrail_rag_fusion.py --demo \
      --query "aspirin lowers stroke risk" \
      --corpus '[{"id":"1","text":"aspirin reduced stroke incidence"},
                 {"id":"2","text":"aspirin bleeding adverse events"}]'
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Sequence, Tuple

# ---------------------------------------------------------------------------
# RRF constants — kept identical to R2R's HybridSearchSettings defaults and to
# lib/retrieval/hybrid.ts so the fusion behaves the way the source algorithm was
# tuned for, and the TS + Python paths agree bit-for-bit on the same inputs.
# ---------------------------------------------------------------------------
RRF_K = 50
DEFAULT_FACET_WEIGHT = 1.0

# The four biomedical facets we decompose every claim into. Fixed + auditable —
# no LLM invents sub-queries. Each facet is a lens on the SAME underlying claim.
FACETS: Tuple[str, ...] = ("efficacy", "safety", "mechanism", "subgroup")


# ---------------------------------------------------------------------------
# Deterministic sub-query decomposition.
#
# Each facet reframes the raw query toward one clinical lens by appending a fixed
# set of facet cue terms. This is a TEMPLATE, not a generation step: the same
# query always yields the same four sub-queries, so the decomposition is fully
# reproducible and reviewable. We keep the original query terms verbatim (so a
# downstream ranker still matches the specifics) and add the facet's cue terms.
# ---------------------------------------------------------------------------
_FACET_CUES: Dict[str, Tuple[str, ...]] = {
    "efficacy": (
        "efficacy",
        "effect size",
        "risk reduction",
        "hazard ratio",
        "primary endpoint",
        "relative risk",
    ),
    "safety": (
        "safety",
        "adverse events",
        "harms",
        "tolerability",
        "toxicity",
        "serious adverse",
    ),
    "mechanism": (
        "mechanism of action",
        "pathway",
        "target",
        "pharmacology",
        "biological mechanism",
    ),
    "subgroup": (
        "subgroup",
        "population",
        "elderly",
        "age",
        "sex",
        "comorbidity",
        "stratified analysis",
    ),
}

_WHITESPACE = re.compile(r"\s+")


def _normalize(text: str) -> str:
    """Lowercase + collapse whitespace. Pure; mirrors the TS normalizer."""
    return _WHITESPACE.sub(" ", text.strip().lower())


@dataclass(frozen=True)
class SubQuery:
    """One facet's deterministic sub-query over the original claim."""

    facet: str
    query: str
    cues: Tuple[str, ...]

    def to_json(self) -> Dict[str, object]:
        return {"facet": self.facet, "query": self.query, "cues": list(self.cues)}


def decompose(query: str) -> List[SubQuery]:
    """Decompose a biomedical claim into one sub-query per fixed facet.

    Deterministic: the base query text is preserved verbatim and each facet's
    fixed cue terms are appended. Returns four SubQuery rows (efficacy, safety,
    mechanism, subgroup) in a stable order. An empty/blank query yields an empty
    list — honest, rather than four empty facets.
    """
    base = query.strip()
    if not base:
        return []
    out: List[SubQuery] = []
    for facet in FACETS:
        cues = _FACET_CUES[facet]
        sub = f"{base} {' '.join(cues)}"
        out.append(SubQuery(facet=facet, query=sub, cues=cues))
    return out


# ---------------------------------------------------------------------------
# Reciprocal Rank Fusion — a verbatim port of R2R's hybrid_search fusion loop,
# generalized from 2 lists to N facet lists. PURE + DETERMINISTIC; no I/O.
#
# For each document across all facet lists:
#   rrf_score = sum_over_facets( weight_f / (rrf_k + rank_f) )
# where rank_f is the document's 1-indexed position in facet f's list (a document
# absent from a facet simply does not contribute that facet's term — it is not
# penalized with a fabricated rank). Ties in the fused score break stably on the
# document id so ordering is identical across runs and platforms.
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class FusedHit:
    """A fused document: id, fused score, and which facets ranked it where."""

    id: str
    rrf_score: float
    facet_ranks: Dict[str, int] = field(default_factory=dict)

    def to_json(self) -> Dict[str, object]:
        return {
            "id": self.id,
            "rrf_score": self.rrf_score,
            "facet_ranks": dict(self.facet_ranks),
        }


def reciprocal_rank_fusion(
    facet_lists: Dict[str, Sequence[str]],
    rrf_k: int = RRF_K,
    weights: Optional[Dict[str, float]] = None,
) -> List[FusedHit]:
    """Fuse per-facet ranked id lists into one ranking with RRF.

    ``facet_lists`` maps a facet name to that facet's ordered ids (best first).
    ``weights`` optionally scales each facet's contribution (defaults to 1.0 for
    every facet). Deterministic and pure: no I/O, stable tie-break on id.
    """
    scores: Dict[str, float] = {}
    facet_ranks: Dict[str, Dict[str, int]] = {}

    for facet, ids in facet_lists.items():
        weight = (weights or {}).get(facet, DEFAULT_FACET_WEIGHT)
        seen_in_facet: set = set()
        for index, doc_id in enumerate(ids):
            if doc_id in seen_in_facet:
                # First occurrence wins the rank; ignore duplicates within a list.
                continue
            seen_in_facet.add(doc_id)
            rank = index + 1  # 1-indexed, matching R2R + the TS port.
            scores[doc_id] = scores.get(doc_id, 0.0) + weight / (rrf_k + rank)
            facet_ranks.setdefault(doc_id, {})[facet] = rank

    hits = [
        FusedHit(id=doc_id, rrf_score=scores[doc_id], facet_ranks=facet_ranks[doc_id])
        for doc_id in scores
    ]
    # Descending fused score; stable secondary sort on id for determinism.
    hits.sort(key=lambda h: (-h.rrf_score, h.id))
    return hits


# ---------------------------------------------------------------------------
# Offline demo ranker. NOT used in production (the TS path ranks against the
# `sources` table); this is a deterministic keyword scorer so the end-to-end
# shape can be exercised with zero infrastructure.
# ---------------------------------------------------------------------------
def _keyword_rank(query: str, corpus: List[Dict[str, str]]) -> List[str]:
    """Rank corpus docs by descending count of query-token hits in their text.

    Deterministic: ties break on doc id. Docs with zero hits are dropped (an
    honest miss rather than a padded list).
    """
    q_tokens = [t for t in _normalize(query).split(" ") if t]
    scored: List[Tuple[int, str]] = []
    for doc in corpus:
        text = _normalize(str(doc.get("text", "")))
        hits = sum(text.count(tok) for tok in q_tokens)
        if hits > 0:
            scored.append((hits, str(doc.get("id", ""))))
    scored.sort(key=lambda p: (-p[0], p[1]))
    return [doc_id for _, doc_id in scored]


def rag_fusion_demo(query: str, corpus: List[Dict[str, str]]) -> Dict[str, object]:
    """End-to-end offline demo: decompose -> keyword-rank per facet -> RRF fuse."""
    subs = decompose(query)
    facet_lists: Dict[str, List[str]] = {
        s.facet: _keyword_rank(s.query, corpus) for s in subs
    }
    fused = reciprocal_rank_fusion(facet_lists)
    return {
        "facets": [s.to_json() for s in subs],
        "facet_lists": facet_lists,
        "fused": [h.to_json() for h in fused],
    }


# ---------------------------------------------------------------------------
# CLI. Reads inputs from flags or stdin; never echoes claim text to argv logs.
# ---------------------------------------------------------------------------
def _read_query(args: argparse.Namespace) -> str:
    if getattr(args, "query", None):
        return str(args.query)
    data = sys.stdin.read()
    return data.strip()


def _fail(message: str) -> int:
    print(json.dumps({"error": message}), file=sys.stdout)
    return 2


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description="PaperTrail biomedical RAG-Fusion (deterministic decomposition + RRF)."
    )
    parser.add_argument("--decompose", action="store_true", help="Decompose a query into facets.")
    parser.add_argument("--fuse", action="store_true", help="Fuse per-facet id lists with RRF.")
    parser.add_argument("--demo", action="store_true", help="End-to-end offline demo over a corpus.")
    parser.add_argument("--query", type=str, default=None, help="Query text (else read from stdin).")
    parser.add_argument("--lists", type=str, default=None, help="JSON: facet -> ordered id list.")
    parser.add_argument("--corpus", type=str, default=None, help="JSON: [{id,text}] demo corpus.")
    parser.add_argument("--rrf-k", type=int, default=RRF_K, help=f"RRF smoothing constant (default {RRF_K}).")
    args = parser.parse_args(list(argv) if argv is not None else None)

    if args.fuse:
        if not args.lists:
            return _fail("--fuse requires --lists (JSON facet -> id list).")
        try:
            raw = json.loads(args.lists)
        except json.JSONDecodeError as exc:
            return _fail(f"invalid --lists JSON: {exc}")
        if not isinstance(raw, dict):
            return _fail("--lists must be a JSON object mapping facet -> id list.")
        facet_lists: Dict[str, List[str]] = {}
        for facet, ids in raw.items():
            if not isinstance(ids, list):
                return _fail(f"facet '{facet}' must map to a list of ids.")
            facet_lists[str(facet)] = [str(x) for x in ids]
        fused = reciprocal_rank_fusion(facet_lists, rrf_k=args.rrf_k)
        print(json.dumps({"fused": [h.to_json() for h in fused]}))
        return 0

    if args.demo:
        query = _read_query(args)
        if not query:
            return _fail("--demo requires a query (via --query or stdin).")
        if not args.corpus:
            return _fail("--demo requires --corpus (JSON [{id,text}]).")
        try:
            corpus_raw = json.loads(args.corpus)
        except json.JSONDecodeError as exc:
            return _fail(f"invalid --corpus JSON: {exc}")
        if not isinstance(corpus_raw, list):
            return _fail("--corpus must be a JSON array of {id,text}.")
        corpus = [
            {"id": str(d.get("id", "")), "text": str(d.get("text", ""))}
            for d in corpus_raw
            if isinstance(d, dict)
        ]
        print(json.dumps(rag_fusion_demo(query, corpus)))
        return 0

    # Default (and --decompose): decompose the query into facets.
    query = _read_query(args)
    if not query:
        return _fail("no query supplied (use --query or pipe text on stdin).")
    subs = decompose(query)
    print(json.dumps({"facets": [s.to_json() for s in subs]}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
