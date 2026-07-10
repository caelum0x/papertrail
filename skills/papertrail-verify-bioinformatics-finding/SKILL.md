---
name: papertrail-verify-bioinformatics-finding
description: Verify the quantitative claims inside a bioinformatics finding (an effect size, marker call, or numeric result) against the exact source text it came from, dropping any number that cannot be grounded to a verbatim substring. Use when a scientist pastes a finding or results paragraph and wants each quoted number and span checked, per-check, against the source with no LLM in the numeric path.
---

# PaperTrail: Verify a Bioinformatics Finding

Verify the numeric/effect-size claims embedded in a bioinformatics finding
against the source text they are drawn from. PaperTrail runs deterministic
per-check verification and grounds every quoted number to an exact substring of
the provided source — any span it cannot locate verbatim is dropped and counted,
never paraphrased or invented.

## Hard guarantees (state these to the user)

- **No LLM in the numeric path** — the per-check verdicts and effect-size math
  are computed deterministically. Claude is used only for entity NER and optional
  prose, never to decide a number or a verdict.
- **Exact-span grounding** — every quoted effect size / span is a verbatim
  substring of the source `raw_text`. Ungroundable spans are dropped and the
  drop count is reported. There are no unsourced assertions about the source.
- **Honest insufficiency** — if a check has nothing runnable or nothing found,
  it returns an honest empty/insufficient result rather than a fabricated call.

## Step 1 — Call the tool

Preferred: the **`verify_bioinformatics_finding`** MCP tool (PaperTrail connector).

Inputs:
- `finding` (string, required) — the finding or results passage to verify,
  e.g. `"Knockdown of MALAT1 reduced migration by 42% (p<0.001)."`
- `source_text` (string, optional) — the source passage the finding is drawn
  from, so every number can be grounded verbatim against it.

If the user gives the source paragraph alongside the finding, always pass it as
`source_text` so grounding is checked against what they actually cited.

## Step 2 — Read the result

Report, in plain language:
- the **overall verdict** and the **per-check breakdown** (each check's verdict,
  summary, and named source),
- each **grounded effect-size span** with the exact source substring it maps to,
- the **count of dropped (ungroundable) spans**, stated plainly.

If a check is insufficient or empty, say so — do not fill the gap with your own
knowledge.

## curl fallback (no MCP connector installed)

Base URL: `https://papertrail-topaz-phi.vercel.app` (override with your own
deployment if needed). No API key required.

```bash
curl -sS -X POST https://papertrail-topaz-phi.vercel.app/api/bio/verify-finding \
  -H 'Content-Type: application/json' \
  -d '{
    "finding": "Knockdown of MALAT1 reduced cell migration by 42% (p<0.001).",
    "source_text": "In migration assays, MALAT1 knockdown reduced migration by 42% relative to control (p<0.001)."
  }'
```

Response is the standard `{ success, data, error }` envelope; the overall
verdict, per-check breakdown, grounded spans, and dropped-span count live under
`data`.

## Notes

- Keep `finding` to a checkable statement or short passage; for a whole document
  use a document-level audit skill instead.
- Never paraphrase a grounded span — quote the exact substring returned.
