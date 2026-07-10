# PaperTrail specialization of R2R: biomedical RAG-Fusion + evidence-sufficiency

`r2r/papertrail_rag_fusion.py` in this directory is a **PaperTrail-native
specialization** of the R2R engine. This repo owns the vendored R2R tree; rather
than fork or fight the upstream retrieval pipeline, we added one file that
re-implements the *deterministic core* of R2R's query decomposition + Reciprocal
Rank Fusion (RRF) in a way that satisfies PaperTrail's moat rules and mirrors the
TypeScript contract the rest of the app relies on (`lib/retrieval/hybrid.ts`).

**No other file in this engine is modified.** `papertrail_rag_fusion.py` is
standalone, **stdlib-only** Python (no R2R install, no model download, no
network), and this whole `backend/engines/` tree is excluded from the Next build —
so there is zero TypeScript/build impact.

---

## Why it exists

Upstream R2R runs a hybrid search that fuses a **dense** (pgvector) and a
**sparse** (full-text) ranking with RRF — see
`py/core/providers/database/chunks.py::hybrid_search`. **RAG-Fusion** generalizes
that idea: instead of fusing two *rankers* over ONE query, it decomposes a query
into several sub-queries, retrieves for each, and fuses the several *result lists*
with the same RRF arithmetic. The lift comes from covering facets of a question
that a single embedding would otherwise blur together.

For a biomedical efficacy claim the useful facets are fixed and clinically
meaningful:

| facet | lens |
| --- | --- |
| `efficacy` | effect size, risk reduction, hazard ratio, primary endpoint |
| `safety` | adverse events, harms, tolerability, toxicity |
| `mechanism` | mechanism of action, pathway, target, pharmacology |
| `subgroup` | population, age/sex, comorbidity, stratified analysis |

We decompose **deterministically** — a fixed, auditable cue template per facet —
rather than asking an LLM to invent sub-queries. Same input query -> same four
sub-queries, always. This keeps the moat rule intact: **no LLM in any
ranking/fusion path.**

| R2R step | `papertrail_rag_fusion.py` |
| --- | --- |
| dense + sparse ranker over one query | `decompose()` — one deterministic sub-query per fixed biomedical facet |
| `hybrid_search` RRF fusion loop | `reciprocal_rank_fusion()` — verbatim port, generalized from 2 lists to N facet lists |
| `HybridSearchSettings` RRF defaults | `RRF_K = 50`, per-facet weight `1.0` — identical to the TS port |

---

## PaperTrail invariants it enforces

- **Deterministic** — no model calls, no network, no randomness. The
  decomposition is a fixed template; the fusion is pure integer-rank arithmetic.
  Same input -> same output, always. Ties in the fused score break stably on the
  document id so ordering is identical across runs and platforms.
- **Provenance on every fused hit** — each hit carries `facet_ranks` (which facets
  ranked it, and at what rank), so a reviewer can see *why* a source surfaced.
- **Honest empty** — a blank query, or facets that all retrieve nothing, yields an
  empty result rather than a fabricated hit.

---

## How it maps to `lib/retrieval/hybrid.ts`

`lib/retrieval/hybrid.ts` exposes the TypeScript RAG-Fusion contract:

```ts
// Deterministic facet decomposition (mirror of decompose()).
export function decomposeIntoFacets(query: string): FacetQuery[]
// Pure N-list RRF (mirror of reciprocal_rank_fusion()).
export function fuseFacetRankings(input: RagFusionInput): RagFusedRank[]
// Full pipeline: decompose -> existing hybridSearch() per facet -> RRF fuse.
export async function ragFusionRetrieve(query, deps?): Promise<RagFusionHit[]>
```

Field-for-field:

| Python (`papertrail_rag_fusion.py`) | TypeScript (`lib/retrieval/hybrid.ts`) |
| --- | --- |
| `FACETS` (`efficacy`/`safety`/`mechanism`/`subgroup`) | `RAG_FUSION_FACETS` |
| `_FACET_CUES` | `FACET_CUES` |
| `decompose()` -> `SubQuery{facet,query,cues}` | `decomposeIntoFacets()` -> `FacetQuery{facet,query,cues}` |
| `reciprocal_rank_fusion()` -> `FusedHit{id,rrf_score,facet_ranks}` | `fuseFacetRankings()` -> `RagFusedRank{id,rrfScore,facetRanks}` |
| `RRF_K = 50` | `RRF_K` (re-used from the existing hybrid module) |

`ragFusionRetrieve()` deliberately reuses the **existing** `hybridSearch()` export
unchanged as its per-facet retriever — the RAG-Fusion layer is additive and never
alters the tuned dense+sparse hybrid behavior.

---

## How to invoke (stdlib only, no install)

```bash
# 1. Decompose a query into biomedical facets (JSON on stdout):
echo "Drug X reduced cardiovascular events by 30% in elderly diabetics" \
  | python3 r2r/papertrail_rag_fusion.py --decompose

# 2. Fuse pre-retrieved per-facet ranked id lists with RRF:
python3 r2r/papertrail_rag_fusion.py --fuse \
  --lists '{"efficacy":["a","b","c"],"safety":["b","d"],"mechanism":["c"]}'

# 3. End-to-end offline demo over an in-memory corpus (no DB):
python3 r2r/papertrail_rag_fusion.py --demo \
  --query "aspirin lowers stroke risk" \
  --corpus '[{"id":"1","text":"aspirin reduced stroke incidence"},
             {"id":"2","text":"aspirin bleeding adverse events"}]'
```

### Output shapes

```json
// --decompose
{ "facets": [ { "facet": "efficacy", "query": "...", "cues": ["efficacy", ...] }, ... ] }

// --fuse
{ "fused": [ { "id": "b", "rrf_score": 0.0392, "facet_ranks": { "efficacy": 2, "safety": 1 } }, ... ] }
```

- Invalid `--lists` / `--corpus` JSON is reported as `{"error": ...}` on stdout
  with exit code `2` (honest boundary failure, never a silent crash).

---

## The evidence-sufficiency loop

The retrieval half of this feature (decompose -> fuse) answers *"did we find the
right sources?"*. The other half answers *"do we have **enough** to conclude?"*
and lives on the TypeScript side in `lib/evidencePipeline.ts::evidenceSufficiency()`.

It is a **deterministic gate** — no LLM — that decides whether a synthesis has
enough grounded evidence to stop, or needs another retrieval pass:

| criterion | threshold |
| --- | --- |
| pooled studies | `>= 3` |
| total participants | `>= 100` |
| heterogeneity (I²) | `< 75%` |
| contradictions | resolved (none open) |

It returns `{ sufficient, reasons[] }`; when `sufficient` is false the `reasons`
name exactly which criteria failed, so the caller can widen retrieval (e.g. run
another RAG-Fusion pass) rather than concluding on thin evidence. This mirrors
the house rule: an honest *"insufficient — needs more evidence"* beats a forced
low-confidence verdict.
