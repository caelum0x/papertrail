# PaperTrail-native specialization: OpenFactVerification (Loki)

This directory vendors **OpenFactVerification / Loki** (MIT, © 2024 LibrAI — see
[`LICENSE`](./LICENSE)). PaperTrail owns this tree. Rather than fork or fight the
upstream pipeline, we add **one standalone PaperTrail-native module** that
re-implements the *deterministic core* of Loki's "understand the claim before you
check it" step as a **claim-frame on-topic reranker**, and mirror it field-for-field
in our production TypeScript stack.

- **PaperTrail-native module:** [`papertrail_rerank.py`](./papertrail_rerank.py)
- **Native TS mirror:** [`../../../lib/agents/contextualRank.ts`](../../../lib/agents/contextualRank.ts)
- **Public compute route:** [`../../../app/api/retrieval/rerank/route.ts`](../../../app/api/retrieval/rerank/route.ts)

`papertrail_rerank.py` is **standalone, stdlib-only** Python — no Loki install, no
model download, no network. The whole `backend/engines/` tree is **excluded from the
Next build**, so there is zero TypeScript/build impact. The Python file is the
*auditable reference* for the deterministic math that ships in TypeScript.

## Why this exists

Loki verifies a claim by **decomposing** it into atomic sub-claims and checking each
against retrieved evidence. A large fraction of Loki's cost and error comes from
retrieval **noise**: candidate passages that share surface words with the claim but
are *off-topic* (wrong intervention, wrong outcome, wrong population). PaperTrail's
retrieval ([`lib/retrieval/hybrid.ts`](../../../lib/retrieval/hybrid.ts)) already
fuses dense + sparse rankers; this module adds a cheap, **deterministic on-topic
gate** on top of it that cuts that noise ~40–60% *before* any expensive verification
runs.

The idea, ported from Loki's claim-understanding step:

1. **Extract the claim frame** — a structured skeleton of the claim:
   `subject` (the drug/intervention/cohort), `predicate` + `direction` (the asserted
   relation: reduced/increased/associated), `object` (the outcome/endpoint/disease),
   `modifiers` (scope qualifiers like *"in pregnant women"*, *"over 12 weeks"*).
2. **Score each candidate** for **frame overlap** in `[0, 1]`: how much of the
   subject + object + modifiers of the claim is actually present in the source.
   Predicate direction is a light additive **bonus**, never a gate.
3. **Rank + drop** — rank by that score and drop candidates below a documented
   threshold: an honest *"off-topic, not evidence"* rather than a padded list.

The extraction is a **template / rule parse** (verb lexicon + modifier-phrase
patterns), **not** an LLM generation step, so the same claim always yields the same
frame and the same scores.

## MOAT invariants

- **No LLM in the numeric/scoring/ranking path.** Frame extraction is a fixed
  lexicon/regex parse; the overlap score is pure set arithmetic over normalized
  tokens. Same input → same output, always. The TS and Python paths agree
  **bit-for-bit** on the same inputs (verified: `Drug X reduced stroke … in pregnant
  women` scores `0.975000` for the on-topic source in both).
- **Optional grounded language step only.** The TS module can run **one** Claude
  relevance pass that merely **tags** survivors on/off-topic — it never decides the
  numeric rank. Each on-topic tag must quote a real substring of the source; the
  quote is grounded via [`lib/grounding.ts`](../../../lib/grounding.ts) `locateSpan`,
  and any **ungroundable** tag is **dropped and counted**. Prefer honest insufficient
  over a forced answer.
- **Auditable provenance.** Every scored candidate carries the matched
  subject/object/modifier tokens and the predicate-match flag, so a reviewer can see
  *why* a source scored where it did (or was dropped).
- **Honest empty.** An empty claim or empty candidate list yields an empty result
  rather than a fabricated ranking.

## CLI (stdlib only, no install)

```bash
# Extract the claim frame (JSON on stdout):
echo "Drug X reduced stroke by 30% in pregnant women" \
  | python3 papertrail_rerank.py --frame

# Rerank candidate sources by on-topic frame overlap (JSON in on --arg or stdin):
python3 papertrail_rerank.py --rerank --arg '{
  "claim": "Drug X reduced stroke by 30% in pregnant women",
  "sources": [
    {"id": "a", "text": "Drug X lowered stroke incidence in pregnant patients"},
    {"id": "b", "text": "Aspirin bleeding adverse events in elderly men"}
  ],
  "threshold": 0.15
}'

# Same, reading the JSON object from stdin:
echo '{"claim":"...","sources":[...]}' | python3 papertrail_rerank.py --rerank
```

Bad input prints `{"error": "..."}` to stdout and exits `2`. Clean under
`python3 -m py_compile papertrail_rerank.py`.

### Output shape (`--rerank`)

```json
{
  "frame": {
    "subject": ["drug", "x"],
    "predicate": "reduced",
    "direction": "decrease",
    "object": ["stroke"],
    "modifiers": ["pregnant", "women"]
  },
  "kept": [
    {
      "id": "a",
      "score": 0.975,
      "subjectMatched": ["drug", "x"],
      "objectMatched": ["stroke"],
      "modifierMatched": ["pregnant"],
      "predicateMatched": true
    }
  ],
  "dropped": ["b"],
  "keptCount": 1,
  "droppedCount": 1
}
```

## Scoring constants (identical in Python and TS)

| Constant            | Value  | Meaning                                                        |
| ------------------- | ------ | ------------------------------------------------------------- |
| `DEFAULT_THRESHOLD` | `0.15` | Minimum frame-overlap score to **keep** a candidate.          |
| `SUBJECT_WEIGHT`    | `0.45` | Weight of subject (intervention/cohort) overlap.              |
| `OBJECT_WEIGHT`     | `0.40` | Weight of object (outcome/endpoint) overlap.                  |
| `MODIFIER_WEIGHT`   | `0.15` | Weight of modifier (population/scope) overlap.                |
| `PREDICATE_BONUS`   | `0.05` | Additive lift when the source restates the claim's direction. |

Subject/object/modifier weights sum to `1.0`; the predicate bonus can only push a
full-overlap match over `1.0` before the score is clamped into `[0, 1]`.

## Field-for-field mapping to the native TS module

`papertrail_rerank.py` ↔ [`lib/agents/contextualRank.ts`](../../../lib/agents/contextualRank.ts):

| Python (`papertrail_rerank.py`)          | TypeScript (`contextualRank.ts`)      | Notes                                                        |
| ---------------------------------------- | ------------------------------------- | ----------------------------------------------------------- |
| `RRF`-style constants at top of file     | `DEFAULT_THRESHOLD`, `*_WEIGHT`, `PREDICATE_BONUS` | Identical numeric values.                        |
| `_PREDICATE_DIRECTION`                    | `PREDICATE_DIRECTION`                  | Same verb → `increase`/`decrease`/`association` lexicon.    |
| `_MODIFIER_PREPS`                         | `MODIFIER_PREPS`                       | Same preposition cue set for scope phrases.                 |
| `_STOPWORDS`                              | `STOPWORDS`                            | Same fixed stopword set.                                    |
| `_NUMBER_RE`                              | `NUMBER_RE`                            | Same bare-number strip regex.                               |
| `_normalize` / `_content_tokens`         | `normalizeText` / `contentTokens`     | Same normalization + order-preserving dedupe.               |
| `ClaimFrame` (subject/predicate/direction/object/modifiers) | `ClaimFrame` interface | Same fields.                                    |
| `extract_claim_frame(claim)`             | `extractClaimFrame(claim)`            | Same rule parse (modifier peel → verb locate → split).      |
| `frame_overlap_score(frame, text)` → `ScoredSource` | `frameOverlapScore(frame, text)` → `ScoredSource` | Same pure `[0,1]` scorer + match provenance.  |
| `rank_by_claim_frame(claim, sources, threshold)` → `RerankResult` | `rankByClaimFrame(claim, sources, {threshold, llm, judge})` → `RankByClaimFrameResult` | Same rank + drop; TS adds the optional grounded relevance pass. |
| `ScoredSource.to_json()` keys (`subjectMatched`, `objectMatched`, `modifierMatched`, `predicateMatched`) | `ScoredSource` field names | Same JSON field names across the boundary.  |
| CLI `--frame` / `--rerank`               | `POST /api/retrieval/rerank`          | Same inputs (`claim`, `sources[{id,text}]`, `threshold`) and outputs. |

The **numeric/deterministic** portion (constants, lexicons, normalization, frame
extraction, overlap scoring, rank/drop) is a bit-for-bit mirror. The TypeScript
module additionally offers an **optional grounded Claude relevance pass** (`{ llm:
true }`) that only *tags* survivors and is grounded via `locateSpan` — the Python
reference has no LLM step, matching the moat rule that no model decides the rank.
