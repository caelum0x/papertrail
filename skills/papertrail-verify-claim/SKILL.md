---
name: papertrail-verify-claim
description: Verify a single efficacy or magnitude claim ("Drug X cut events by 30%") against its primary source and flag any discrepancy. Use when a scientist pastes a specific quantitative clinical claim and wants it checked against PubMed/ClinicalTrials.gov with a trust score and exact citation trail.
---

# PaperTrail: Verify a Claim

Verify one efficacy/magnitude claim against its primary source. PaperTrail
retrieves the best-matching source, extracts the actual finding, and returns a
verdict, a trust score, and `flagged_spans` that map to exact substrings of the
cached source text. This is a provenance check, not an opinion.

## Hard guarantees (state these to the user)

- **Deterministic recompute** — the same claim + source yields the same verdict
  and the same effect-size math every time. No sampling drift on the numbers.
- **Exact-span grounding** — every flagged span is a verbatim substring of the
  cached source `raw_text`. There are no unsourced assertions about the source.
- **Honest `no_support_found`** — if retrieval finds no confident match, the
  result is `discrepancy_type: "no_support_found"`, never a fabricated or
  low-confidence "match." A wrong confident answer is worse than an honest miss.

## Step 1 — Call the tool

Preferred: the **`verify_claim`** MCP tool (PaperTrail connector).

Inputs:
- `claim` (string, required) — one sentence or short passage, 10–2000 chars.
  e.g. `"Semaglutide reduced major adverse cardiovascular events by 20%."`
- `source_hint` (string, optional) — a DOI, PMID, or NCT id the user actually
  cited, to pin verification to that exact source.

If the user gives a paper or trial id alongside the claim, always pass it as
`source_hint` so you verify against what they cited, not just the best match.

## Step 2 — Read the result

Report, in plain language:
- the **verdict / `discrepancy_type`** (supported, overstated, understated,
  wrong direction, `no_support_found`, etc.),
- the **trust score**,
- each **flagged span** with the source quote it grounds to (the substring of
  `raw_text`), and the **source citation** (title, id, link).

If `discrepancy_type` is `no_support_found`, say so plainly — do not fill the
gap with your own knowledge. Suggest the user supply a `source_hint`.

## curl fallback (no MCP connector installed)

Base URL: `https://papertrail-topaz-phi.vercel.app` (override with your own
deployment if needed). No API key required.

```bash
curl -sS -X POST https://papertrail-topaz-phi.vercel.app/api/verify \
  -H 'Content-Type: application/json' \
  -d '{
    "claim": "Semaglutide reduced major adverse cardiovascular events by 20%.",
    "source_hint": "NCT03574597"
  }'
```

Response is the standard `{ success, data, error }` envelope; the verdict,
trust score, `flagged_spans`, and source citation live under `data`.

## Notes

- Keep `claim` to a single checkable statement. For a whole paragraph, use the
  `papertrail-research-brief` or a text/document fact-check skill instead.
- Never paraphrase a flagged span — quote the exact grounded substring.
