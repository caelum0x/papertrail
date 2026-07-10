---
name: papertrail-trial-matcher
description: Match a de-identified patient case to eligible clinical trials on ClinicalTrials.gov with per-criterion eligibility reasoning. Use when a scientist or clinician pastes de-identified patient notes and asks which trials the patient might qualify for. Requires a PaperTrail org API key.
---

# PaperTrail: Trial Matcher

Turn de-identified patient notes into a grounded patient profile, search
ClinicalTrials.gov, and assess eligibility trial-by-trial with per-criterion
verdicts. This is an **org-scoped** tool and requires authentication.

## Governance (critical — state and honor)

- **De-identified input only.** Never paste PHI. Raw notes are never persisted
  and never logged — only a de-identified profile, note character count, and
  the match verdicts are stored.
- **Deterministic recompute** — the eligibility assessment is reproducible for
  the same notes and trial set.
- **Exact-span grounding** — each eligibility verdict cites the specific
  inclusion/exclusion criterion text it was judged against; no eligibility
  claim is made without the criterion it maps to.
- **Honest non-match** — trials that don't clearly fit are reported as such,
  not stretched into a match.

## Step 1 — Call the tool (auth required)

Preferred: the **`match_patient_to_trials`** MCP tool.

Inputs:
- `notes` (string, required) — de-identified patient notes, 10–20000 chars.

Auth: the org-scoped tools require `PAPERTRAIL_API_KEY` set in the MCP server
environment; it is sent as `Authorization: Bearer <key>`.

## Step 2 — Read the result

Report:
- the **de-identified patient summary** the engine derived,
- the **candidate trials** (NCT id, title, phase, status), and
- for each, the **eligibility verdict** with the specific criteria met / not
  met / unknown, each tied to the trial's criterion text.

Flag any criterion the notes don't cover as "unknown" rather than guessing.

## curl fallback (no MCP connector installed)

Base URL: `https://papertrail-topaz-phi.vercel.app`. **Requires** a Bearer
token (`PAPERTRAIL_API_KEY`). Hits the v1 org route.

```bash
curl -sS -X POST https://papertrail-topaz-phi.vercel.app/api/v1/trial-matcher \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $PAPERTRAIL_API_KEY" \
  -d '{
    "notes": "62-year-old with type 2 diabetes, HbA1c 8.4%, eGFR 55, on metformin, no prior MI, non-smoker."
  }'
```

Returns the standard `{ success, data, error }` envelope with the profile,
candidate trials, and per-criterion eligibility.

## Notes

- If you get a 401/403, the API key is missing or lacks Editor+ scope for this
  org — tell the user to configure `PAPERTRAIL_API_KEY`.
- Keep everything de-identified. If the notes contain identifiers, ask the user
  to remove them before matching.
