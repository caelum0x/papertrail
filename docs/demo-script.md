# Demo Script — LOCKED examples

Three examples, all pinned to real primary sources and pre-ingested (run
`DEMO_MODE=true` so retrieval is cache-only and never hits the live API on stage).
Full verified detail + verbatim source quotes in `tests/fixtures/demo-claims.json`.

> Golden rule: every underline shown on stage is a verbatim substring of the cached
> source, enforced by `lib/grounding.ts` (ungroundable spans are dropped). Never
> improvise with an un-ingested claim — PubMed latency and match quality are unpredictable.

## Example 1 — Catches a real distortion (neurodegeneration / Gladstone: Finkbeiner)

- **Claim:** "In the CLARITY-AD trial, lecanemab slowed cognitive decline by 27% and the
  drug caused brain swelling (ARIA-E edema) in 21.3% of patients."
- **Source:** van Dyck et al., *Lecanemab in Early Alzheimer's Disease*, NEJM 2023 —
  PMID 36449413 (DOI 10.1056/NEJMoa2212948).
- **Expected:** `magnitude_overstated`, trust score in the red band.
- **Why it matters:** two distortions, both provable from the abstract. (1) The abstract
  reports the primary result as a **CDR-SB difference of −0.45 points**, not "27%"; the 27%
  relative figure is derived and not stated in the source. (2) The claim mislabels the ARIA-E
  (edema) rate — the abstract says **12.6%**, not 21.3% (21.3% is the combined any-ARIA figure,
  not in this abstract). Flagged source spans: `"difference, -0.45"` and `"amyloid-related
  imaging abnormalities with edema or effusions in 12.6%"`.
- **Note:** the deterministic effect-size layer returns `cannot_reconcile` here (no parseable
  ratio) — by design. The catch is the LLM verdict + code-enforced exact-span grounding.

## Example 2 — Confirms accuracy (cardiovascular / Gladstone: Srivastava)

- **Claim:** "In SPRINT, intensively lowering systolic blood pressure to below 120 mm Hg in
  adults at increased cardiovascular risk without diabetes reduced the primary composite
  cardiovascular outcome, with a hazard ratio of 0.75 versus a target below 140 mm Hg."
- **Source:** SPRINT Research Group, NEJM 2015 — PMID 26551272 (DOI 10.1056/NEJMoa1511939).
- **Expected:** `accurate`, trust score 90+, **zero flags** — proves it isn't a blanket skeptic.
- **Why it matters:** every element (target <120 vs <140 mm Hg, non-diabetic higher-CV-risk
  population, **composite** outcome, HR 0.75) is verbatim-true. Deliberately NOT mislabeled as a
  heart-failure trial. The effect-size layer independently returns `consistent`.

## Example 3 — Honest abstention (cardiovascular near-miss)

- **Claim:** "Dapagliflozin reduced the risk of worsening heart failure in patients with heart
  failure and a reduced ejection fraction, with a hazard ratio of 0.75."
- **Cited source:** SPRINT (PMID 26551272) — the WRONG paper for this claim.
- **Expected:** `no_support_found` (honest abstention).
- **Why it matters:** the claim even cites a hazard ratio (0.75) that *coincidentally matches*
  SPRINT's, but SPRINT tests blood-pressure targets in non-diabetic hypertensives — not
  dapagliflozin in HFrEF. The tool refuses to be seduced by a numeric coincidence and abstains
  rather than forcing a false "confident" match. This is the trust beat research judges love.

## Talking points (3-min arc)

1. **Problem / named user (0:00–0:30):** a postdoc days from certifying an NIH progress report,
   legally attesting every efficacy claim. "1 in 6 biomedical citations misrepresents its source."
2. **Hero catch (0:30–1:45):** Example 1. Staged pipeline reveal → the exact flagged span SNAPS
   to a highlight in the real source, claim glows red. "Every underline is a verbatim substring of
   the source — code-enforced. We never say anything about the paper we can't point to in the paper."
3. **Credibility + honesty (1:45–2:15):** Example 2 passes clean (green); Example 3 abstains.
4. **Depth / eval (2:15–2:45):** run the PMID-pinned eval set live; show accuracy + span-grounding
   rate. "Published tools match supporting quotes as little as 46% of the time. Here's ours, in the open."
5. **Impact / outlast-the-week (2:45–3:00):** deployed Vercel URL + open-source repo.

## Architecture one-liner
retrieval (pgvector) → extraction (Claude) → verification (Claude) + a deterministic
effect-size cross-check → every flag grounded to an exact source substring in code.
