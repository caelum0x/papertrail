# PaperTrail specialization of autoresearcher (eimenhmdt/autoresearcher)

`papertrail_review.py` in this directory is a **PaperTrail-native specialization** of the
autoresearcher engine. This repo owns the vendored autoresearcher tree; rather than fork or
fight the upstream LLM loop, we added one file that ports autoresearcher's *citation-grounded
literature review* into a deterministic, groundable form that satisfies PaperTrail's moat
rules and mirrors the TypeScript agent in `lib/moa/agents/autoreview.ts`.

**No other file in this engine is modified.** `papertrail_review.py` is standalone,
stdlib-only Python (no autoresearcher install, no network, no model download), and this whole
directory is excluded from the Next build — so there is zero TypeScript/build impact.

---

## Why it exists

Upstream autoresearcher runs an **LLM-driven** loop: generate search queries → fetch papers
(OpenAlex / Semantic Scholar) → feed the abstracts to an LLM that writes a literature-review
answer with inline citations. Both the review **prose** and the **choice of what to cite** are
decided by the model, over live-fetched abstracts.

PaperTrail's **moat rule** is: *no LLM in the verdict / numeric / attribution path.* So this
file borrows the **shape** — a citation-grounded review that says which sources support and
which refute, with verbatim citations ordered by credibility — but strips the black box. Given
a claim plus per-source **labels** (SUPPORTS / REFUTES / NEI) and quality **weights** already
produced deterministically upstream (by `lib/moa/agents/minicheck` + paper-qa's `quality`), it
deterministically assembles the review skeleton.

| autoresearcher step | `papertrail_review.py` |
| --- | --- |
| generate queries + live-fetch papers | consumes the sources already retrieved & cached upstream; **no network** |
| LLM picks what to cite | deterministic filter: only SUPPORTS / REFUTES labels **with a grounded span** |
| LLM writes review prose with citations | deterministic partition (supporting / refuting) + ordering by quality weight |
| *(implicit)* citation ordering | `_order_side`: weight desc, source id asc, input order asc, capped per side |
| *(missing)* honest "not enough to review" | fewer than two grounded sources → `{"error": ...}` + exit 2 |

The one LLM step the TS agent keeps — **connective prose over the ALREADY-selected
citations** — has no bearing on which sources are cited, how they are ordered, or the coverage
number, so it is intentionally absent here. This Python module computes only the deterministic
skeleton, making it a by-hand cross-check of the TS hot path.

---

## What it computes (all deterministic)

1. **Decisive-citation filter** — `_candidates`: keep a source only when its label is
   `SUPPORTS` or `REFUTES` **and** it carries a groundable span (non-empty verbatim text +
   integer offsets). NEI / unlabeled / ungroundable sources contribute no citation. Mirrors the
   decisive-label filter in `autoreview.ts`.
2. **Side ordering** — `_order_side` for each of `SUPPORTS` / `REFUTES`: order by quality
   `weight` (desc), then `source_id` (asc), then input order (asc); truncate to
   `MAX_CITATIONS_PER_SIDE = 5`. Missing weight → `DEFAULT_WEIGHT = 0.5`.
3. **Coverage** — fraction of decisively-labeled sources that contributed a grounded citation;
   this is the review's completeness signal (the TS agent uses it as the contribution
   confidence).
4. **Summary** — `_deterministic_summary`: a single safe sentence from the grounded counts
   alone; this is the fallback and the seed the TS agent's optional Claude prose step may
   rewrite (never changing a citation or count).

Every constant is FIXED and **identical** to `lib/moa/agents/autoreview.ts`, so the Python
engine is an exact by-hand cross-check of the TS hot path.

---

## PaperTrail invariants it enforces

- **Deterministic** — no model calls, no network. Same input → same output, always.
- **Groundable** — every citation it emits is already a verbatim substring of its source
  (grounded upstream by `lib/grounding.ts` `locateSpan`); this file never invents a quote and
  drops any span it cannot treat as grounded (non-empty text + integer offsets).
- **Honest abstention** — fewer than two grounded sources → `{"error": ...}` + exit 2, matching
  the TS agent's `skippedContribution` ("not enough to assemble a review"). A review
  **summarizes**; it never fabricates a side.
- **No LLM in the verdict** — which sources are cited, their ordering, the counts, and coverage
  are decided by rule; Claude (in the TS agent only) writes connective prose over the
  already-selected citations and can never change them.

---

## How to run

```bash
python papertrail_review.py --json '{
  "claim": "Drug X reduced major cardiovascular events by 30%",
  "sources": [
    {"id":"pmid:1","label":"SUPPORTS","weight":0.9,
     "span":{"text":"a 30% reduction in major adverse cardiovascular events","start":112,"end":168}},
    {"id":"pmid:2","label":"REFUTES","weight":0.6,
     "span":{"text":"no significant difference in the primary endpoint","start":80,"end":130}},
    {"id":"pmid:3","label":"NEI","weight":0.4,"span":null}
  ]
}'
```

Prints one JSON object mirroring `ResearchBriefFinding` plus the review counts:
`summary`, `citations` (`source_id`, `side`, `text`, `start`, `end`, `weight`),
`supporting_count`, `refuting_count`, `coverage`, `labeled_source_count`,
`grounded_source_count`. On bad JSON or fewer than two grounded sources, prints
`{"error": ...}` and exits with code 2.
```
