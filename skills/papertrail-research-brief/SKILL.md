---
name: papertrail-research-brief
description: Produce a grounded, citation-backed research brief on a scientific question by planning sub-questions, retrieving primary literature, and synthesizing an answer where every claim maps to a source span. Use when a scientist asks an open research question and wants a sourced brief, or wants a specific question answered strictly from the literature.
---

# PaperTrail: Grounded Research Brief

Answer a scientific question from the primary literature, with every statement
tied to a source. Two depths: a full **deep-research** brief (plans and answers
sub-questions) and a focused **paper-QA** answer to a single question.

## Hard guarantees (state these to the user)

- **Exact-span grounding** — each claim in the brief carries citations that map
  to exact character offsets in the cited source text. No unsourced sentences.
- **Deterministic-leaning recompute** — retrieval runs against the cached
  source corpus, so the same question surfaces the same evidence.
- **Honest `no_support_found`** — if the literature does not support an answer,
  the tool returns `no_support_found` rather than fabricating one. Report that
  honestly; do not backfill from your own knowledge.

## Step 1 — Full brief (`deep_research`)

Call the **`deep_research`** MCP tool.

Inputs:
- `question` (string, required, 10–2000 chars) — one focused research question,
  e.g. `"What is the evidence that PCSK9 inhibitors reduce cardiovascular mortality?"`

Report the research plan (sub-questions), the per-sub-question evidence with
citations, and the synthesized answer. Every claim shows its grounding source.

## Step 2 — Focused answer (`paper_qa`)

For a single narrow question, call the **`paper_qa`** MCP tool.

Inputs:
- `question` (string, required, 10–2000 chars).
- `limit` (number, optional, 1–8) — number of sources to draw from.

Report the answer with its inline citations, or `no_support_found` if the
literature doesn't support it.

## curl fallback (no MCP connector installed)

Base URL: `https://papertrail-topaz-phi.vercel.app`. No API key required.

Deep research brief:

```bash
curl -sS -X POST https://papertrail-topaz-phi.vercel.app/api/deep-research \
  -H 'Content-Type: application/json' \
  -d '{ "question": "What is the evidence that PCSK9 inhibitors reduce cardiovascular mortality?" }'
```

Focused paper-QA:

```bash
curl -sS -X POST https://papertrail-topaz-phi.vercel.app/api/paper-qa \
  -H 'Content-Type: application/json' \
  -d '{ "question": "Does semaglutide reduce MACE in patients with obesity?", "limit": 6 }'
```

Both return the standard `{ success, data, error }` envelope.

## Notes

- Keep the question focused (one topic) for the tightest grounding. Split
  multi-part questions into separate calls.
- Never present an ungrounded statement as part of the brief. If a needed fact
  isn't in the returned evidence, say it's outside the retrieved sources.
