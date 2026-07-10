# PaperTrail specialization of PyKEEN (TransE)

`papertrail_train.py` in this directory is a **PaperTrail-native specialization** of the
PyKEEN engine. This repo owns the vendored PyKEEN tree; rather than fork or run upstream's
torch/GPU training loop, we added one file that re-implements the *deterministic core* of
PyKEEN's **TransE** model in a way that satisfies PaperTrail's moat rules and produces
weights that are **bit-compatible** with the TypeScript mirror the app actually serves
from.

**No other file in this engine is modified.** `papertrail_train.py` is standalone,
stdlib-only Python (no `torch`, no `numpy`, no PyKEEN install, no model download, no
network), and this whole directory is excluded from the Next build — so there is zero
TypeScript/build impact.

---

## Why it exists

The topology link-predictor (`lib/kg/linkPredict.ts`) already ranks candidate links from
**graph structure alone** (common-neighbors / Adamic-Adar / resource-allocation /
preferential-attachment — PyKEEN's *baseline* family). This engine adds the complementary
**learned** view: a TransE embedding trained over the `kg_edges` triples, so a candidate
`(subject, predicate, object)` can be scored by the classic translational distance
`||v_subject + v_predicate - v_object||`. A **small** distance means the triple fits the
geometry training induced — a plausible novel link.

Upstream PyKEEN TransE (`src/pykeen/models/unimodal/trans_e.py`) trains entity/relation
embeddings with a torch optimizer on GPU, sampling corrupted negatives and minimizing a
margin-ranking (hinge) loss over `||h + r - t||`. PaperTrail's **moat rule** is: *no LLM,
and no non-reproducible numeric path, anywhere in a verdict/score/training loop.* So this
file keeps TransE's exact math and drops the black box:

| PyKEEN TransE step | `papertrail_train.py` |
| --- | --- |
| Interaction `||h + r - t||` (`TransEInteraction`) | `_transe_distance()` (identical L2 translation) |
| Random embedding init (`xavier_uniform_`) | `_seeded_init()` — Glorot-width uniform, but derived from an **FNV-1a hash** of `(seed, id, coordinate)`, so init is byte-reproducible, not random |
| Entity-norm constraint (`functional.normalize`) | `_normalize()` — entity vectors projected to the unit sphere each update |
| Negative sampling (`BasicNegativeSampler`) | deterministic corruption: an **LCG** picks the corruption side and the corrupt entity |
| Margin-ranking loss + Adam/SGD | plain deterministic SGD with the hinge `if pos + MARGIN > neg` guard |
| Shuffled minibatches | deterministic Fisher-Yates shuffle driven by the same LCG |

Fixed hyperparameters (`DIM=16, EPOCHS=100, LEARNING_RATE=0.01, MARGIN=1.0,
SEED=20260709`) are the reproducibility contract — they are duplicated **verbatim** in
`lib/kg/learnedLinkPredict.ts`, so the Python offline trainer and the on-demand TypeScript
trainer produce the same embedding for the same edge order (verified: max abs diff
`~7e-16`, floating-point epsilon).

---

## PaperTrail invariants it enforces

- **Deterministic** — no random init, no GPU non-determinism, no network. Same edge list →
  same embedding → same ranking, always. There is **no LLM** in any vector, distance, or
  ranking. Claude never touches this path.
- **Closed vocabulary** — only the three KG predicates (`associates_with`, `targets`,
  `treats` — mirrors `KG_PREDICATES` in `lib/kg/schemas.ts`) are trained on; any other
  predicate triple is **dropped**, never coerced.
- **Honest miss** — an empty or all-invalid edge list yields empty `entities`/`relations`
  (and downstream, `trained: false` with a `note`) rather than fabricated vectors. Absent
  embeddings surface as "learned prediction unavailable," never a guessed link.
- **Boundary failure is explicit** — unreadable/invalid JSON input is reported as
  `{"error": ...}` on stdout with exit code `2`, never a silent crash.

---

## How `lib/kg` consumes the weights

### Serialized output → `kg_embeddings` rows

`papertrail_train.py` writes JSON to stdout:

```json
{
  "dim": 16,
  "entities":  { "<entity-uuid>": [ <16 floats> ], ... },
  "relations": { "associates_with": [ <16 floats> ], ... },
  "entity_count": N, "relation_count": M, "edge_count": E
}
```

Each `entities[id]` maps to one row in `kg_embeddings` (migration
`0068_kg-embeddings.sql`) with `kind='entity'`, `key=id`, `vector=[...]`, `dim=16`; each
`relations[pred]` maps to a row with `kind='relation'`, `key=pred`. The unique index on
`(kind, key)` is the upsert target, so re-training refreshes vectors in place.

### The scorer — `lib/kg/learnedLinkPredict.ts`

`learnedLinkPredict.ts` is the **TypeScript mirror** of this file plus the read/rank side:

| `papertrail_train.py` | `learnedLinkPredict.ts` |
| --- | --- |
| `_fnv1a` | `fnv1a` |
| `_seeded_init` | `seededInit` |
| `_lcg` | `lcg` |
| `_normalize` / `_l2_norm` | `normalize` / `l2Norm` |
| `_transe_distance` | `transeDistance` |
| `train_kg_embeddings` | `trainKgEmbeddings` |
| (offline → stdout JSON) | `loadAllEdges` + `trainAndPersist` (on-demand from `kg_edges`) |
| — | `loadEmbeddings` / `persistEmbeddings` (read/write `kg_embeddings`) |
| — | `predictLearnedLinks` (rank candidates by ascending TransE distance) |

Two ways the weights reach production:

1. **Offline** — run `papertrail_train.py` over the current `kg_edges` triples and load
   the JSON into `kg_embeddings`.
2. **On demand** — `POST /api/kg/predict/learned` calls `trainAndPersist`, which reads
   `kg_edges` via parameterized SQL, runs the identical TS trainer, and upserts the same
   rows. Because both trainers share the FNV-1a init, the LCG schedule, and the
   hyperparameters, the on-demand result equals the offline result for the same edge order.

### Scoring a candidate

`predictLearnedLinks(pool, fromNode, embeddings, { predicate, limit })`:

1. gathers the local candidate object nodes via a bounded BFS over `repository.neighbors`
   (same candidate rule as `linkPredict.ts`),
2. skips self-links and already-existing direct links,
3. scores each remaining candidate by `transeDistance(head, rel, tail)` using the loaded
   vectors, and
4. returns them **ascending by distance** (smaller = stronger), id tie-broken for a stable
   order. Candidates with no learned vector are omitted honestly (not scored as 0).

---

## How to invoke

Standalone, stdlib only (no install):

```bash
# 1. Edge list as JSON on stdin.
echo '[{"subject_id":"NCBI Gene:673","predicate":"targets","object_id":"CHEMBL:CHEMBL1201583"},
       {"subject_id":"NCBI Gene:673","predicate":"associates_with","object_id":"MESH:D008545"}]' \
  | python3 papertrail_train.py

# 2. Edge list from a file.
python3 papertrail_train.py --edges-file edges.json
```

To regenerate `edges.json` from the live graph, dump `kg_edges` as
`{subject_id, predicate, object_id}` objects (the same shape `loadAllEdges` reads).

### Extending / tuning

The trainer is intentionally minimal. If you change any hyperparameter (`DIM`, `EPOCHS`,
`LEARNING_RATE`, `MARGIN`, `SEED`) you **must** change it identically in
`lib/kg/learnedLinkPredict.ts` — the two constants blocks are the reproducibility contract,
and a drift between them breaks the bit-compatibility guarantee (and would let the offline
and on-demand embeddings disagree).
