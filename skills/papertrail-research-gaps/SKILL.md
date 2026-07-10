---
name: papertrail-research-gaps
description: Surface grounded research gaps and generate testable hypotheses for a topic, each anchored to the literature. Use when a scientist asks "what's unknown / understudied here?" or "what should we test next?" and wants gap analysis and hypotheses backed by citations rather than speculation.
---

# PaperTrail: Research Gaps and Hypotheses

For a given topic, mine the literature for what is under-studied or unresolved
and propose testable hypotheses — each anchored to the evidence that motivates
it.

## Hard guarantees (state these to the user)

- **Exact-span grounding** — each identified gap and each hypothesis is tied to
  the source spans that motivate it. Gaps are derived from what the retrieved
  literature does and does not establish, not from the model's imagination.
- **Deterministic-leaning recompute** — retrieval runs over the cached corpus,
  so the same topic surfaces the same evidence base.
- **Honest limits** — if the topic returns little grounded evidence, the tool
  says so rather than inventing gaps or hypotheses from nothing.

## Step 1 — Call the tool

Preferred: the **`research_gaps_hypotheses`** MCP tool.

Inputs:
- `topic` (string, required) — the research area, e.g.
  `"GLP-1 receptor agonists in neurodegeneration"`.
- `query` (string, optional, 1–2000 chars) — a narrower probe within the topic.
- `limit` (number, optional, 1–20) — how many sources to draw from.

## Step 2 — Read the result

Report the **research gaps** (each with the grounding source spans that reveal
the gap) and the **testable hypotheses** (each with its motivating evidence).
Present hypotheses as testable and falsifiable — flag any that the retrieved
literature cannot yet support.

## curl fallback (no MCP connector installed)

Base URL: `https://papertrail-topaz-phi.vercel.app`. No API key required.

```bash
curl -sS -X POST https://papertrail-topaz-phi.vercel.app/api/hypotheses \
  -H 'Content-Type: application/json' \
  -d '{
    "topic": "GLP-1 receptor agonists in neurodegeneration",
    "query": "microglial inflammation",
    "limit": 8
  }'
```

Returns the standard `{ success, data, error }` envelope with gaps and
hypotheses under `data`.

## Notes

- A sharper `topic`/`query` yields sharper, better-grounded gaps.
- Keep hypotheses tied to their motivating evidence; do not present an
  ungrounded idea as a literature-derived gap.
