# PaperTrail specialization of paper-qa

Upstream [`paper-qa`](https://github.com/Future-House/paper-qa) (Apache-2.0) is a
retrieval-augmented QA system over scientific papers. Its synthesis step treats every
retrieved passage as equally trustworthy once it clears retrieval. PaperTrail is a
provenance/verification tool, so it cannot: a claim "confirmed" by a **retracted** paper
or an **unreviewed preprint** is not confirmed. This specialization adds a deterministic
source-quality layer **in place**, without modifying any upstream file.

## What we added

`papertrail_source_quality.py` — **source-quality tiers + evidence weight**.

Given a batch of source metadata, it assigns each source:

- a **tier** — `A` / `B` / `C` / `D`, and
- a **quality weight** in `[0, 1]` that synthesis multiplies its evidence by, and
- a human-readable **rationale**.

### Tier rubric (documented, evaluated top to bottom — first match caps)

| Condition | Tier | Weight (base) |
| --- | --- | --- |
| Retracted (Retraction Watch id present, or `retracted: true`) | **D** untrusted | 0.00 (hard cap) |
| Peer-reviewed journal + citations ≥ `WELL_CITED_THRESHOLD` (100) | **A** | 1.00 |
| Peer-reviewed journal (journal name present, not a preprint) | **B** | 0.80 |
| Preprint / unknown venue + citations ≥ `PREPRINT_CITED_THRESHOLD` (50) | **B** (capped) | 0.80 |
| Preprint / unknown venue | **C** | 0.50 |

- **Retraction is a HARD CAP.** A retracted source is Tier D / weight 0 regardless of
  journal, citations, or open-access status. It can never support a claim.
- **Open access never changes the tier** (access model is orthogonal to trust). It adds a
  small transparent weight bonus (`OPEN_ACCESS_BONUS = 0.05`) on non-D tiers only, so an
  open-access source is marginally preferred between two otherwise-equal sources, without
  letting access buy a higher tier. All weights are clamped to `[0, 1]`.
- A preprint promoted to B on citations is **capped at B** — sustained citation is weak
  evidence the community vetted it, but it was never formally peer reviewed, so it can
  never reach A.

### Why this matters for PaperTrail

The weight is the quantity synthesis multiplies an evidence item by, so a Tier-C preprint
contributes half the pooled weight of a Tier-A vetted journal article, and a retracted
source contributes nothing. This is a **supporting weight on evidence — it never decides a
verdict by itself**; the verdict math lives in the deterministic verification/synthesis
path. The tier only tells the caller how far to trust each source.

## Design constraints honored

- **Stdlib-only.** Uses only `argparse` + `json` + `dataclasses` — no third-party deps —
  so it runs anywhere the backend runs and can be shelled out to without installing the
  full `paper-qa` package.
- **Deterministic. No LLM.** Tier and weight are a pure, documented function of the
  metadata; the same metadata always yields the same tier, weight, and rationale.
- **Governance-safe.** Handles only source METADATA (journal name, year, integer citation
  count, boolean flags, opaque ids) — never claim, source-body, or patient text — so its
  JSON output is safe to log.
- **Honest input handling.** On malformed input it prints `{"error": ...}` and exits `2`.
  A missing/invalid citation count deterministically becomes `0` rather than failing.

## CLI

Reads a JSON object on `--arg` or from stdin, prints JSON to stdout.

```bash
echo '{"sources":[{"id":"s1","journal":"NEJM","citations":300,"is_open_access":true}]}' \
  | python papertrail_source_quality.py

python papertrail_source_quality.py --arg '{"sources":[{"id":"s2","retraction_watch_id":"RW-123"}]}'
```

```python
from papertrail_source_quality import score_source, SourceMeta, tier_sources

print(tier_sources({"sources": [{"id": "s1", "is_preprint": True, "citations": 80}]}))
# -> {"tiers": [{"id": "s1", "tier": "B", "weight": 0.8, ...}], "count": 1}
```

## Native TS twin + field-for-field mapping

The scorer is mirrored deterministically in TypeScript at
[`lib/paperqa/sourceQuality.ts`](../../../lib/paperqa/sourceQuality.ts) and exposed as a
public compute route at `app/api/sources/quality-tier/route.ts` (POST
`{ sources: [...] }`). The numeric rubric constants are identical in both files.

| Python (`papertrail_source_quality.py`) | TypeScript (`lib/paperqa/sourceQuality.ts`) |
| --- | --- |
| `WELL_CITED_THRESHOLD = 100` | `WELL_CITED_THRESHOLD = 100` |
| `PREPRINT_CITED_THRESHOLD = 50` | `PREPRINT_CITED_THRESHOLD = 50` |
| `BASE_WEIGHT_BY_TIER` (A 1.0 / B 0.8 / C 0.5 / D 0.0) | `BASE_WEIGHT_BY_TIER` (same) |
| `OPEN_ACCESS_BONUS = 0.05` | `OPEN_ACCESS_BONUS = 0.05` |
| `SourceMeta` dataclass | `SourceQualityMeta` interface |
| `SourceTier` dataclass | `SourceQualityResult` interface |
| `SourceTier.tier` (`"A".."D"`) | `SourceQualityResult.tier: SourceQualityTier` |
| `SourceTier.weight` | `SourceQualityResult.weight` |
| `SourceTier.retracted` | `SourceQualityResult.retracted` |
| `SourceTier.rationale` | `SourceQualityResult.rationale` |
| `to_dict()["tier_label"]` | `SourceQualityResult.tierLabel` |
| `score_source(meta)` | `scoreSourceQuality(meta)` |
| `tier_sources({"sources": [...]})` | `scoreSourceQualityBatch(metas)` |
| `_clamp01` (round 4 dp, clamp `[0,1]`) | `clamp01` (round 4 dp, clamp `[0,1]`) |
| `_as_nonneg_int` (invalid -> 0) | `asNonNegInt` (invalid -> 0) |
| retracted OR Retraction Watch id -> D | retracted OR `retraction_watch_id` -> D |

`backend/engines/` is excluded from the Next build, so this module has zero TypeScript
impact. Upstream files are unchanged; this specialization is additive.
