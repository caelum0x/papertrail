# PaperTrail specialization of lucereal/AutoResearcher (Coverage-Gap Gather)

`papertrail_gather.py` in this directory is a **PaperTrail-native specialization** of the
lucereal/AutoResearcher engine. This repo owns the vendored AutoResearcher tree; rather than
run upstream's query-generation + **live** paper/web gathering, we added one file that keeps
AutoResearcher's **query-generation + coverage-gap** idea and turns it into a **deterministic,
offline** analysis over trusted sources the caller already holds.

**No other file in this engine is modified.** `papertrail_gather.py` is standalone, stdlib-only
Python (no AutoResearcher install, no model download, **no network**), and this whole directory
is excluded from the Next build — so there is zero TypeScript/build impact.

---

## Why it exists

Upstream AutoResearcher takes a topic, uses an LLM to **generate search queries**, and then
**live-fetches** papers/abstracts (and, in some flavours, web/social sources) to gather
evidence. Two things collide with PaperTrail's rules:

1. **Live fetch / untrusted sources.** PaperTrail's convention is *cache everything from trusted
   biomedical sources; never re-fetch on every request; never depend on live API latency; and
   never pull in social media.* An orchestration agent must be **stateless with no network**.
2. **LLM in a measurement path.** PaperTrail's moat rule: *no LLM, and no non-reproducible path,
   anywhere in a score / ranking / verdict.* "Which facets of this claim are covered by the
   evidence we have?" is exactly such a measurement.

So this file keeps AutoResearcher's *structure* — decompose a claim into per-facet sub-queries,
then check what the gathered evidence covers — but replaces the LLM query-gen + live fetch with
**deterministic query-generation** (facet × key entity) and **deterministic keyword coverage**
over the sources already in context. A **gap is not a refutation**: it means the evidence set
does not span a clinical lens the claim implies.

| AutoResearcher step | `papertrail_gather.py` |
| --- | --- |
| LLM generates search queries from the topic | `_generate_and_cover` — deterministic grid: FACETS × key entities |
| live-fetch papers/abstracts (+ web/social) for each query | **no fetch** — coverage is measured over the caller-provided `sources` only |
| LLM judges relevance / synthesizes | deterministic keyword coverage; `insufficient` iff a **major** facet is uncovered |

---

## The facets and the coverage rule

The claim is decomposed into four clinical **facets**, each with whole-word **cue** terms:

| Facet | Major? | Meaning of "covered" |
| --- | --- | --- |
| `efficacy` | **yes** | a source mentions a key entity AND an efficacy cue (effective, reduced, hazard ratio, endpoint, survival, …) |
| `safety` | no | … a safety cue (adverse, toxicity, tolerability, mortality, …) |
| `mechanism` | no | … a mechanism cue (pathway, receptor, inhibit, binding, signaling, …) |
| `population` | no | … a population cue (patients, cohort, subgroup, randomized, phase, enrolled, …) |

A **sub-query** is `facet × key entity`. It is **covered** when some on-topic source mentions
**both** the entity and one of that facet's cues (whole-word, case-insensitive). Coverage
fraction = `covered / total`. The vote is:

```
if any MAJOR facet has an uncovered sub-query -> "insufficient"   (honest: cannot fully verify)
else                                          -> "neutral"        (adequate span; no direction)
confidence = coverage fraction
```

Key entities seed the grid: the caller passes scispaCy's grounded surface texts in `entities`;
if none are given, the tool falls back to salient claim tokens (>= 4 chars, non-stop-word).

---

## PaperTrail invariants it enforces

- **Deterministic** — no randomness, no network, no model. Same `claim` + `entities` +
  `sources` → same sub-queries → same coverage map, always. Claude never touches it
  (`usedClaude` is always `false`).
- **Trusted sources only, no live fetch** — the tool never queries PubMed/ClinicalTrials.gov,
  the web, or any social feed; it only measures coverage of the sources handed to it.
- **Honest gaps** — a coverage gap is reported as a gap, never spun into a refutation; a major
  gap yields `insufficient` ("couldn't verify from what we hold") rather than a forced answer.
- **Drop, never coerce** — malformed input is rejected at the boundary: `claim` must be a
  string; `sources` a non-empty array of `{id: non-empty str, text: str}` (blank-text sources
  are skipped like the TS `hasUsableText` filter); `rank` a number in `[0,1]`; `offTopic` a
  boolean; `entities` an array of strings or absent.
- **Boundary failure is explicit** — unreadable/invalid JSON or a structurally invalid payload
  is reported as `{"error": ...}` on stdout with exit code `2`, never a silent crash.

---

## Field-for-field mapping to the native TS agent

`lib/moa/agents/autogather.ts` is the **on-demand TypeScript agent** the MoA orchestrator runs
(category `deliberation`, `produces: []`, `consumes: ["entities", "relevance"]`, gate `0.4` when
`>= 1` source). This Python file is its **offline twin** for batch/eval use — same facets, same
cues, same coverage rule, same `MAX_KEY_ENTITIES` / `MAX_DETAIL_IDS`, so the two agree on any
identical input. The `FACETS` table here **must** stay identical to `FACETS` in
`lib/moa/agents/autogather.ts`; a drift would let the offline gather and the on-demand agent
report different coverage from the same claim + entities + sources.

| `papertrail_gather.py` output field | `lib/moa/agents/autogather.ts` |
| --- | --- |
| `signal` (`neutral` / `insufficient`) | contribution `signal` |
| `confidence` / `coverageFraction` | contribution `confidence` = coverage fraction |
| `subQueries[]` (`facet, entity, major, covered, coveredSourceIds, matchedCue`) | `detail.subQueries` |
| `covered[]` / `gaps[]` | `detail.covered` / `detail.gaps` |
| `totalSubQueries` / `coveredCount` / `gapCount` / `majorGapCount` | same `detail.*` counts |
| `keyEntities` / `entitySeedSource` | `detail.keyEntities` / `detail.entitySeedSource` |
| `onTopicSourceCount` / `droppedOffTopicCount` | `detail.onTopicSourceCount` / `detail.droppedOffTopicCount` |

In the TS agent, `entities` come from scispaCy's `entities` artifact off the blackboard and the
on-topic set + per-source `rank` come from Loki's `relevance` artifact (`droppedIds` → the
Python `offTopic` flag; `rankById` → the Python `rank`). When either artifact is absent the TS
agent degrades honestly (claim-token fallback / all sources at rank 1), exactly as this Python
twin does when `entities` is empty / `offTopic` is unset.

---

## How to invoke

Standalone, stdlib only (no install):

```bash
# 1. JSON on stdin — one source covering efficacy for the key entities.
echo '{"claim":"Drug X reduced events by 30%",
       "entities":["Drug X","events"],
       "sources":[{"id":"s1","text":"Drug X reduced events (hazard ratio 0.70)."}]}' \
  | python3 papertrail_gather.py

# 2. Inline via --arg.
python3 papertrail_gather.py --arg '{"claim":"...","entities":["..."],"sources":[{"id":"s1","text":"..."}]}'

# 3. From a file.
python3 papertrail_gather.py --input-file gather.json
```

### Extending / tuning

`FACETS` (ids, `major` flags, cue vocabularies), `MAX_KEY_ENTITIES`, and `MAX_DETAIL_IDS` are the
reproducibility contract. They **must** stay identical to the same constants in
`lib/moa/agents/autogather.ts` — a drift between the two would let the offline Python gather and
the on-demand TypeScript agent reach different coverage maps from identical inputs.
