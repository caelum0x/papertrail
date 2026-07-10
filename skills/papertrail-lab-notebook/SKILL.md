---
name: papertrail-lab-notebook
description: Structure rough bench notes into a reproducible experimental record (hypothesis, materials, methods, steps, results, next steps). Use when a scientist pastes messy lab notes and wants them turned into a clean, structured, reproducible protocol. Requires a PaperTrail org API key.
---

# PaperTrail: Lab Notebook Structuring

Turn a scientist's rough, free-text bench notes into a structured, reproducible
experimental record. This is an **org-scoped** tool and requires authentication.

## Governance and guarantees (state and honor)

- **Grounded in the notes only.** The engine structures what you actually wrote.
  Anything it could not find in the notes is reported as omitted/discarded — it
  does not invent methods, reagents, or results that aren't in the source.
- **Privacy.** Raw notes are never logged — only counts. Do not paste secrets
  or identifiers.
- **Deterministic-leaning recompute** — the same notes structure to the same
  record so a protocol is reproducible from run to run.

## Step 1 — Call the tool (auth required)

Preferred: the **`structure_experiment`** MCP tool.

Inputs:
- `notes` (string, required) — rough bench notes, 1–20000 chars.

Auth: requires `PAPERTRAIL_API_KEY` in the MCP server environment, sent as
`Authorization: Bearer <key>`.

## Step 2 — Read the result

Present the structured record — typically hypothesis/objective, materials &
reagents, step-by-step methods, results/observations, and next steps — plus a
note of anything in the raw text that was **discarded** because it didn't map to
a field. Surface the discarded items so the scientist can decide whether to add
them back.

## curl fallback (no MCP connector installed)

Base URL: `https://papertrail-topaz-phi.vercel.app`. **Requires** a Bearer
token (`PAPERTRAIL_API_KEY`). Hits the v1 org route.

```bash
curl -sS -X POST https://papertrail-topaz-phi.vercel.app/api/v1/lab-notebook \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $PAPERTRAIL_API_KEY" \
  -d '{
    "notes": "seeded HEK293 6-well 2e5/well. 24h later transfected PCSK9 plasmid lipofectamine. harvested 48h, western for LDLR. band looked lighter in KD. redo w/ loading ctrl next time"
  }'
```

Returns the standard `{ success, data, error }` envelope with the structured
record under `data`.

## Notes

- If you get a 401/403, the API key is missing or lacks the required scope —
  tell the user to configure `PAPERTRAIL_API_KEY`.
- Do not embellish. If the notes omit a concentration, timepoint, or control,
  leave it blank and flag it rather than filling it in.
