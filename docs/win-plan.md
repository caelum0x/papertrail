# PaperTrail — Plan to Win the Builder Track

_Synthesized from a 12-agent research + adversarial-critique workflow (competitive
landscape, Claude Science, Gladstone users, hackathon patterns, technical depth,
agentic architecture) + independent code review. Judging: Impact 25 / Claude Use 25 /
Depth 20 / **Demo 30**. Target: **Builder Track 1st ($30k API credits)**. Deadline:
Mon Jul 13, 9 PM ET._

> **Note on the Gladstone Award:** the $10k Gladstone Institutes Award is **Research
> track only**. We can't win it. But Gladstone reps judge Builder too, so tuning the
> demo to their disease areas (cardiovascular / neurodegeneration) drives our Impact
> score. Gladstone appeal is a means, not the prize.

## Positioning (the wedge)

PaperTrail is the open-source **reviewer agent** that audits the one direction no
incumbent targets: not *"find me papers"* (Consensus/Elicit) or *"how do others cite
this paper"* (scite), but **"does the sentence I already wrote overstate the specific
trial I cited — and prove it by underlining the exact words in the source."**

- **Named user:** a postdoc in a Gladstone-style cardiovascular (Srivastava) or
  neurodegeneration (Finkbeiner) lab, days from certifying an NIH RPPR or submitting a
  manuscript, personally on the hook for every efficacy claim they cite.
- **The guarantee that wins:** claim-vs-cited-source verification with **code-enforced
  exact-span provenance** — every flagged span is a verbatim substring of cached source
  text, auto-dropped if it can't be located, so the tool *structurally cannot* make an
  unsourced claim about a paper. Consensus (no deep links), SciSpace (hallucinated
  attributions), Elicit (46% quote-match), and Anthropic's own same-model reviewer all
  documented as lacking exactly this. We make it visible, testable, and eval-scored.

## The 5 differentiators (each maps to a judging criterion)

| # | Differentiator | Scores | Effort | The catch |
|---|---|---|---|---|
| 1 | **Code-enforced exact-span provenance (HERO).** Ground every `source_span` in `raw_text` (exact → whitespace-normalized → anchored match); drop/relabel any span that can't be located; UI highlights the located span in-place, side-by-side with the claim. | Demo + Depth + Claude Use | med | Invariant is currently UNENFORCED. Build first. Degrade to "quote located approximately" — never show a false highlight. |
| 2 | **Pin-to-cited-source + top-k rerank abstention.** Optional DOI/PMID/NCT input to verify against the paper actually cited. Replace limit-1 retrieval with top-k(5) + Claude rerank that must confirm shared intervention/population/endpoint, else honest `no_support_found`. | Impact + Depth + Claude Use | med | Fixes "verified against the WRONG trial" — the failure a careful scientist won't forgive. `DEMO_MODE` = cache-only on stage. |
| 3 | **Deterministic effect-size reconciliation (the ONE depth feature).** Parse estimate + measure + 95% CI (RR/HR/OR/RRR); hard-flag (a) claimed magnitude ≫ source estimate → `magnitude_overstated`, (b) CI crosses null while claim asserts benefit → `caveat_dropped`. Degrade to "cannot reconcile numerically". | Depth + Impact | med | A number that can't be made to wobble by re-submitting — interrogable by quantitative judges. |
| 4 | **Visible agentic pipeline + Opus 4.8 reasoning panel.** Stream the retrieval→extraction→verification chain as staged steps; collapsible "how PaperTrail reasoned" panel (Opus adaptive thinking). Revertible one-line config swap. | Claude Use + Demo | low | Currently the whole chain hides behind one card. Turns dead-air latency into suspense. Revert to Sonnet if any fixture regresses. |
| 5 | **Live eval dashboard on PMID-pinned fixtures.** Rewrite fixtures to pin `source_external_id` + `expected_flagged_substrings`; LLM-as-judge harness (correct type, every span grounded, score in band) in CI + one-screen dashboard. Contrast Elicit's 46%. | Depth + Demo | med | A real accuracy number beats any anecdote. Includes the accurate case it correctly does NOT flag (proves no over-flagging). |

## 6-Day Roadmap (solo)

- **Day 1 (Mon) — Fix facts, lock the invariant, kill live-fetch on stage.**
  (1) Fix factual errors in hero examples (see below). (2) Enforce exact-substring
  invariant in `verificationAgent.ts` + a failing fixture test. (3) Pre-ingest & hand-
  verify the two hero sources by pinned PMID/NCT. (4) Add `DEMO_MODE` cache-only flag so
  `retrieveSource` never live-fetches on stage.
  → _Two hero sources cached/corrected/span-verified; grounding enforced with a test that
  fails loudly; `DEMO_MODE` live; `demo-script.md` filled with real claim text + true verdicts._
- **Day 2 (Tue) — Correctness core.** Pin-to-source input; top-k(5) + Claude rerank/
  abstention gate; deterministic effect-size layer; rewrite ALL fixtures to pin
  `source_external_id` + `expected_flagged_substrings`; seed `ingest-test-set.ts` by pinned ID.
- **Day 3 (Wed) — Cheap wins early.** Streamed staged-pipeline reveal; LLM-as-judge eval
  harness in CI; revertible Opus 4.8 swap + reasoning panel; "copy citation-trail" export;
  prompt caching (`cache_control`) on source blocks to protect the $200 budget.
- **Day 4 (Thu) — Demo UI + DEPLOY.** Two-column claim/source layout; in-place `<mark>`
  highlight snap; trust-score count-up; "Try this claim" chips (3 locked examples);
  eval-dashboard screen; deploy to Vercel and run the FULL chain on the deployed URL.
- **Day 5 (Fri) — Freeze + rehearse.** Run the demo on the DEPLOYED URL 5+ times; time
  each example (~20s warm); every Definition-of-Done box checked; draft the 100–200 word summary.
- **Day 6 (Sat–Sun) — Record + submit.** 3-min video against warm cached results; README/
  repo polish for open-source judging; submit well before Mon 9 PM ET. **Cut the MCP server
  unless it's fully filmable running in Claude Desktop by Saturday.**

## Demo beat sheet (3:00, built backward from the highlight-snap)

1. **0:00–0:30 Problem / name the user.** Mock NIH RPPR paragraph, ~40 citations. "One in
   six biomedical citations misrepresents its source." Show the manual re-read as the "before."
2. **0:30–1:45 Hero catch.** Chip: _"Lecanemab slowed Alzheimer's cognitive decline by 27%."_
   Pipeline reveals as staged steps → **the exact flagged substring SNAPS to a highlight** in
   the real source, claim glows red on "27%". Flags stack (magnitude 27% relative vs −0.45
   absolute CDR-SB; population male-sig / female non-sig; caveat ARIA-E 12.6% omitted). Open
   the Opus reasoning panel. VO: "Every underline is a verbatim substring of the source —
   code-enforced."
3. **1:45–2:15 Credibility + honesty.** Green pass on a precisely-stated BP claim (SPRINT,
   HR 0.75, zero flags). Then abstention: a plausible near-miss where the reranker refuses —
   "nearest match doesn't share the intervention — I won't guess."
4. **2:15–2:45 Depth / eval.** Run PMID-pinned fixtures live; show the score. "Published tools
   match supporting quotes as little as 46% of the time. Here's ours, in the open." Click
   "copy citation-trail" → provenance block lands in the mock RPPR.
5. **2:45–3:00 Impact.** Deployed Vercel URL + GitHub repo. "Usable by any lab today, without
   me in the room."

## 🔴 Day-1 factual corrections (do BEFORE caching anything)

The research caught errors that a Gladstone cardiovascular/NEJM-literate judge would catch
instantly — the exact error class the tool claims to catch, self-inflicted:

- **SPRINT is NOT a heart-failure trial.** It's hypertension / composite-CVD (primary outcome
  = composite of MI, ACS, stroke, acute decompensated HF, CV death; HR 0.75). Reframe the green
  case as _"intensive BP control reduced major cardiovascular events by ~25%"_, OR swap to a true
  HF trial (DAPA-HF / EMPEROR-Reduced).
- **Lecanemab — VERIFIED against the actual CLARITY-AD abstract (PMID 36449413):** the only
  effect/safety numbers that appear *in the abstract* are the CDR-SB `difference, -0.45` and
  `edema or effusions in 12.6%` (ARIA-E). The widely-quoted **"27% relative slowing" and the
  "combined ARIA 21.3%" figures are NOT in the abstract** (21.3% is a combined any-ARIA figure
  from the full paper). So the hero catch is built the correct way round: the *claim* asserts
  "27% slowing" and mislabels 21.3% as the ARIA-E edema rate, and the *source substrings* that
  prove the drift (`difference, -0.45`, `amyloid-related imaging abnormalities with edema or
  effusions in 12.6%`) are exact, verbatim, and confirmed present. Do not put 27%/21.3%/17.3%
  in an `expected_flagged_substrings` — they'd fail the grounding invariant. See
  `tests/fixtures/demo-claims.json`.
- **The deterministic effect-size layer correctly DEFERS on lecanemab** (`cannot_reconcile`): the
  abstract has no parseable ratio/RRR and the claim's "slowed by 27%" isn't a comparable measure.
  That's by design — it fires on the cardiovascular examples (HR/RRR), not here. The lecanemab
  catch is carried by the LLM verdict + code-enforced grounding.

## Scope guard — do NOT build this week

Self-consistency / majority-vote sampling · LLM-level determinism via temperature/top_p
(400s on Opus 4.8 — determinism = caching) · evaluator-optimizer loops that override verdicts ·
batch / 50-citation pipelines · MCP server (unless fully filmable by Sat) · fine-tuning any
NLI/encoder model · accounts/auth/history/PDF-upload/Zotero · atomic decomposition (>4
dimensions) · new source types (no bioRxiv/press releases) · live PubMed on the demo critical path.

## Top risks (verified against the code)

1. **Exact-substring invariant unenforced** (`schemas.ts` FlaggedSpanSchema only type-checks;
   `verificationAgent.ts` returns model output raw). → Day-1 grounding assertion + failing test.
2. **`retrieveSource()` live-fetches on cache miss** (`retrievalAgent.ts:22`) and retrieval is
   **limit-1 with no rerank** → wrong-trial or mid-demo latency. → `DEMO_MODE` + top-k rerank.
3. **Fixtures are generic & source-free**; `ingest-test-set.ts` seeds by fuzzy query (non-
   deterministic). → Pin by PMID/NCT.
4. **$200 cap vs Opus 4.8 + thinking.** → Cache extraction + per-(claim,source) verification;
   prompt-cache source blocks; gate expensive paths to the 3 locked claims.
5. **Abstract-only extraction** misses caveats that live in full text. → PMC full-text for the
   two hero examples only; acknowledge the limit honestly in README.
6. **Not deployed.** → Deploy Day 4, rehearse on the live URL Day 5.

## Doc drift to fix in passing
- `ARCHITECTURE.md` says `vector(1536)` (OpenAI) — real schema is `vector(1024)` (Voyage).
- `ARCHITECTURE.md` references `api/retrieve` + `api/extract` routes that don't exist (single
  orchestrating `api/verify`).
