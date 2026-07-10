---
name: papertrail-safety-signal
description: Compute a pharmacovigilance disproportionality signal (PRR and ROR with CIs) for a drug-event pair from FDA FAERS. Use when a scientist asks whether a drug is associated with an adverse event, or wants to reproduce/quantify a safety signal from a published 2x2 table.
---

# PaperTrail: Safety Signal (Pharmacovigilance)

Compute disproportionality statistics — PRR (Proportional Reporting Ratio) and
ROR (Reporting Odds Ratio) with confidence intervals — for a drug-adverse-event
pair, from the FDA FAERS spontaneous-reporting database.

## Hard guarantees (state these to the user)

- **Deterministic recompute** — PRR, ROR, and their CIs are computed by a fixed
  statistical engine from the 2x2 contingency table. Same counts, same signal.
- **Grounded in real reports** — the 2x2 is fetched from openFDA/FAERS (or
  supplied directly), so the signal traces back to actual report counts, not a
  model's guess.
- **Honest absence** — if the drug-event pair has no retrievable reports, the
  result says `found: false` rather than manufacturing a signal.
- **Disproportionality ≠ causation.** Always state that a signal flags a
  reporting association for review, not a proven causal effect.

## Step 1 — Call the tool (two input modes)

Preferred: the **`bio_safety_signal`** MCP tool.

Mode A — by name (fetches the 2x2 from FAERS):
- `drug` (string, required, 1–200 chars)
- `event` (string, required, 1–200 chars) — the adverse event term

Mode B — from a pre-assembled 2x2 (deterministic, no network; reproduce a
published table):
- `a`, `b`, `c`, `d` (non-negative integers) — the contingency counts.

## Step 2 — Read the result

Report PRR and ROR each with their 95% CI, the underlying counts, and whether
the lower CI bound clears the usual signal threshold. Add the causation caveat.

## curl fallback (no MCP connector installed)

Base URL: `https://papertrail-topaz-phi.vercel.app`. No API key required.

By name:

```bash
curl -sS -X POST https://papertrail-topaz-phi.vercel.app/api/bio/safety-signal \
  -H 'Content-Type: application/json' \
  -d '{ "drug": "rosiglitazone", "event": "myocardial infarction" }'
```

From a published 2x2:

```bash
curl -sS -X POST https://papertrail-topaz-phi.vercel.app/api/bio/safety-signal \
  -H 'Content-Type: application/json' \
  -d '{ "a": 120, "b": 880, "c": 4300, "d": 210000 }'
```

Returns the standard `{ success, data, error }` envelope.

## Notes

- Use exact MedDRA-style event terms where possible for a cleaner FAERS pull.
- FAERS is spontaneous reporting: subject to reporting bias, confounding by
  indication, and no denominator of exposed patients. State these limits.
