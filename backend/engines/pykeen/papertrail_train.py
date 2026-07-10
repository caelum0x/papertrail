#!/usr/bin/env python3
"""PaperTrail specialization of PyKEEN TransE — a deterministic, stdlib-only trainer.

This file is a PaperTrail-native specialization of the PyKEEN engine (this repo owns
the vendored PyKEEN tree under backend/engines/pykeen/). Rather than fork or run
upstream's torch/GPU training loop, we add ONE standalone file that re-implements the
*deterministic core* of TransE (models/unimodal/trans_e.py) in a way that satisfies
PaperTrail's moat rules and produces the SAME weights as the TypeScript mirror
`trainKgEmbeddings` in lib/kg/learnedLinkPredict.ts.

**No other file in this engine is modified.** This module is standalone Python with NO
third-party imports (no torch, no numpy, no PyKEEN install, no network), and this whole
directory is excluded from the Next build — zero TypeScript/build impact.

TransE embeds each entity e and relation r as a vector, modeling a true triple (h, r, t)
by the translation h + r ~= t and scoring by the L2 distance ||h + r - t||. Training
uses margin-ranking (hinge) over corrupted negatives, exactly as in the original TransE
paper and PyKEEN's default. We deliberately drop the learned optimizer/GPU and use plain
deterministic SGD so the run is byte-reproducible.

MOAT / reproducibility guarantees (identical to the TS mirror):
  * fixed global SEED
  * initialization derived from an FNV-1a hash of (seed, id, coordinate) — NOT random
  * a deterministic LCG drives per-epoch shuffling and negative sampling
  * entity vectors renormalized to the unit sphere each update

There is NO LLM anywhere in these numbers; the same edge list always yields the same
embedding. Claude never touches a vector, a distance, or a ranking.

USAGE (stdlib only, no install):

    # edge list as JSON on stdin: a list of {"subject_id","predicate","object_id"}.
    echo '[{"subject_id":"a","predicate":"targets","object_id":"b"},
           {"subject_id":"b","predicate":"associates_with","object_id":"c"}]' \
      | python3 papertrail_train.py

    # or via --edges-file
    python3 papertrail_train.py --edges-file edges.json

OUTPUT (stdout, JSON) — the serialized entity + relation vectors, ready to load into the
kg_embeddings table (migration 0068_kg-embeddings.sql):

    {
      "dim": 16,
      "entities":  { "<entity-id>": [<dim floats>], ... },
      "relations": { "<predicate>": [<dim floats>], ... },
      "entity_count": N, "relation_count": M, "edge_count": E
    }

The TypeScript scorer (lib/kg/learnedLinkPredict.ts) consumes exactly this shape: each
`entities[id]` becomes a kg_embeddings row (kind='entity', key=id, vector=[...]), each
`relations[pred]` a row (kind='relation', key=pred, vector=[...]). See PAPERTRAIL.md.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from typing import Dict, List, Tuple

# ---------------------------------------------------------------------------
# Hyperparameters — MUST stay identical to lib/kg/learnedLinkPredict.ts so the two
# trainers produce bit-compatible weights given the same edge order.
# ---------------------------------------------------------------------------

DIM = 16               # embedding dimensionality
EPOCHS = 100           # passes over the edge list
LEARNING_RATE = 0.01   # SGD step
MARGIN = 1.0           # margin-ranking hinge margin
SEED = 20260709        # fixed global seed (repo build date)
INIT_RANGE = 6.0 / math.sqrt(DIM)  # Glorot-style uniform init half-width

# The closed predicate vocabulary the KG persists (mirrors KG_PREDICATES in
# lib/kg/schemas.ts). Triples with any other predicate are dropped, never coerced.
VALID_PREDICATES = ("associates_with", "targets", "treats")

_UINT32 = 0xFFFFFFFF
_FNV_OFFSET = 2166136261
_FNV_PRIME = 16777619


def _fnv1a(text: str) -> int:
    """32-bit FNV-1a hash of a string. Matches `fnv1a` in learnedLinkPredict.ts."""
    h = _FNV_OFFSET
    for ch in text:
        h ^= ord(ch) & 0xFF
        h = (h * _FNV_PRIME) & _UINT32
    return h & _UINT32


def _seeded_init(entity_id: str, idx: int, seed: int) -> float:
    """Hash-seeded coordinate in [-INIT_RANGE, INIT_RANGE). Deterministic.

    Mirrors `seededInit`: map the 32-bit hash to [0, 1) then to the init range.
    """
    h = _fnv1a(f"{seed}:{entity_id}:{idx}")
    unit = h / 4294967296.0
    return (unit * 2.0 - 1.0) * INIT_RANGE


def _lcg(state: int) -> int:
    """Numerical-Recipes LCG advance. Matches `lcg` in learnedLinkPredict.ts."""
    return ((state * 1664525) + 1013904223) & _UINT32


def _l2_norm(vec: List[float]) -> float:
    return math.sqrt(sum(x * x for x in vec))


def _normalize(vec: List[float]) -> List[float]:
    """Project onto the unit sphere (||v|| = 1); a zero vector is returned unchanged."""
    norm = _l2_norm(vec)
    if norm == 0.0:
        return list(vec)
    return [x / norm for x in vec]


def _transe_distance(head: List[float], rel: List[float], tail: List[float]) -> float:
    """L2 distance of the TransE translation: ||head + rel - tail||."""
    total = 0.0
    for i in range(len(head)):
        d = head[i] + rel[i] - tail[i]
        total += d * d
    return math.sqrt(total)


def train_kg_embeddings(
    edges: List[Tuple[str, str, str]]
) -> Tuple[Dict[str, List[float]], Dict[str, List[float]]]:
    """Deterministic TransE trainer. Mirrors trainKgEmbeddings() step-for-step.

    `edges` is a list of (subject_id, predicate, object_id) triples. Returns
    (entities, relations) dicts mapping id -> DIM-length vector.
    """
    entity_ids = sorted({e[0] for e in edges} | {e[2] for e in edges})
    relation_ids = sorted({e[1] for e in edges})

    if not edges or not entity_ids:
        return {}, {}

    entities: Dict[str, List[float]] = {}
    for eid in entity_ids:
        vec = [_seeded_init(eid, k, SEED) for k in range(DIM)]
        entities[eid] = _normalize(vec)

    relations: Dict[str, List[float]] = {}
    for rid in relation_ids:
        # Relations are NOT unit-normalized in TransE; init from the hash directly.
        relations[rid] = [_seeded_init(rid, k, SEED + 1) for k in range(DIM)]

    n_entities = len(entity_ids)
    rng = _fnv1a(f"shuffle:{SEED}") & _UINT32

    for _epoch in range(EPOCHS):
        # Deterministic Fisher-Yates shuffle of edge indices for this epoch.
        order = list(range(len(edges)))
        for i in range(len(order) - 1, 0, -1):
            rng = _lcg(rng)
            j = rng % (i + 1)
            order[i], order[j] = order[j], order[i]

        for idx in order:
            subject_id, predicate, object_id = edges[idx]
            head = entities.get(subject_id)
            rel = relations.get(predicate)
            tail = entities.get(object_id)
            if head is None or rel is None or tail is None:
                continue

            # Deterministically choose corruption side + corrupt entity from the LCG.
            rng = _lcg(rng)
            corrupt_tail = (rng & 1) == 0
            rng = _lcg(rng)
            corrupt_id = entity_ids[rng % n_entities]
            corrupt = entities.get(corrupt_id)
            if corrupt is None:
                continue

            neg_head = head if corrupt_tail else corrupt
            neg_tail = corrupt if corrupt_tail else tail

            pos_dist = _transe_distance(head, rel, tail)
            neg_dist = _transe_distance(neg_head, rel, neg_tail)

            # Margin-ranking hinge: only step when the margin is violated.
            if pos_dist + MARGIN <= neg_dist:
                continue

            pos_scale = LEARNING_RATE / pos_dist if pos_dist > 0 else 0.0
            neg_scale = LEARNING_RATE / neg_dist if neg_dist > 0 else 0.0

            for k in range(DIM):
                pos_grad = head[k] + rel[k] - tail[k]
                neg_grad = neg_head[k] + rel[k] - neg_tail[k]

                # Positive triple: shrink pos_dist.
                head[k] -= pos_scale * pos_grad
                tail[k] += pos_scale * pos_grad
                rel[k] -= pos_scale * pos_grad

                # Negative triple: grow neg_dist (opposite sign).
                neg_head[k] += neg_scale * neg_grad
                neg_tail[k] -= neg_scale * neg_grad
                rel[k] += neg_scale * neg_grad

            # Renormalize the entity vectors that changed to the unit sphere.
            entities[subject_id] = _normalize(head)
            entities[object_id] = _normalize(tail)
            entities[corrupt_id] = _normalize(corrupt)

    return entities, relations


def _parse_edges(raw: object) -> List[Tuple[str, str, str]]:
    """Validate + normalize the input edge list. Closed predicate vocabulary only.

    Accepts a JSON list of objects with keys subject_id/predicate/object_id. A malformed
    or unknown-predicate triple is DROPPED (never coerced) — honest omission over a
    fabricated edge.
    """
    if not isinstance(raw, list):
        raise ValueError("edge list must be a JSON array of triples")
    edges: List[Tuple[str, str, str]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        subject_id = item.get("subject_id")
        predicate = item.get("predicate")
        object_id = item.get("object_id")
        if not isinstance(subject_id, str) or not subject_id:
            continue
        if not isinstance(object_id, str) or not object_id:
            continue
        if not isinstance(predicate, str) or predicate not in VALID_PREDICATES:
            continue
        edges.append((subject_id, predicate, object_id))
    return edges


def main(argv: List[str]) -> int:
    parser = argparse.ArgumentParser(
        description="Deterministic TransE-style KG embedding trainer (PaperTrail)."
    )
    parser.add_argument(
        "--edges-file",
        help="Path to a JSON file with the edge list; if omitted, read JSON from stdin.",
    )
    args = parser.parse_args(argv)

    try:
        if args.edges_file:
            with open(args.edges_file, "r", encoding="utf-8") as handle:
                raw = json.load(handle)
        else:
            raw = json.load(sys.stdin)
    except (OSError, json.JSONDecodeError) as exc:
        json.dump({"error": f"could not read edge list: {exc}"}, sys.stdout)
        sys.stdout.write("\n")
        return 2

    try:
        edges = _parse_edges(raw)
    except ValueError as exc:
        json.dump({"error": str(exc)}, sys.stdout)
        sys.stdout.write("\n")
        return 2

    entities, relations = train_kg_embeddings(edges)

    output = {
        "dim": DIM,
        "entities": entities,
        "relations": relations,
        "entity_count": len(entities),
        "relation_count": len(relations),
        "edge_count": len(edges),
    }
    json.dump(output, sys.stdout)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
