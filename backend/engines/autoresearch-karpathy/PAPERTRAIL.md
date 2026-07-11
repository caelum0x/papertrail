# PaperTrail specialization of karpathy/autoresearch (Bounded Evidence-Refinement Loop)

`papertrail_loop.py` in this directory is a **PaperTrail-native specialization** of the
karpathy/autoresearch engine. This repo owns the vendored autoresearch tree; rather than
run upstream's GPU/nanochat training-search agent, we added one file that ports its
**propose → evaluate → keep/discard bounded loop** from *training-run search* to
**evidence refinement**, and makes the continue/stop decision with field-standard
thresholds instead of a model.

**No other file in this engine is modified.** `papertrail_loop.py` is standalone,
stdlib-only Python (argparse + json — no torch, no training, no model download, no
network), and this whole directory is excluded from the Next build — so there is zero
TypeScript/build impact.

---

## Why it exists

Upstream karpathy/autoresearch is a research agent for **GPU / nanochat training**: it
PROPOSES a candidate change to a training run, EVALUATES it by actually training and
measuring a metric, and KEEPs or DISCARDs the change — iterating a bounded number of
rounds in a search over configurations.

PaperTrail's **moat rule** is: *no LLM, and no non-reproducible path, anywhere in a
score / ranking / verdict — **including a loop-control decision**.* "Do we have enough
evidence to conclude, or should we run another refinement pass, and if so what should it
be?" is exactly such a decision. So this file keeps autoresearch's **bounded
propose/evaluate/keep-discard structure** but re-targets it to evidence and replaces the
learned/metric evaluation with a **deterministic sufficiency gate** over numbers the
deterministic engines already produced.

| karpathy/autoresearch step | `papertrail_loop.py` |
| --- | --- |
| propose a candidate change to the training run | `decide_next_step` — one concrete refinement action |
| evaluate it (train / measure a metric) | `evidence_sufficiency` — the four-criterion gate (**no LLM**) |
| keep if better / discard if not; loop again | `stop` if sufficient; else propose next step + `cap_reached` |
| max iterations / bounded config search | `MAX_ROUNDS` hard cap — the loop always terminates |

There is **NO GPU, NO training, NO network, NO model** — only evidence logic.

---

## The boundary that decides continue vs. stop

The decision is made **entirely** by `plan_refinement(state)`, which runs the **same**
sufficiency gate the rest of PaperTrail uses (`evidence_sufficiency` here;
`evidenceSufficiency` in `lib/evidencePipeline.ts`). It passes only when **all four**
field-standard criteria hold:

```
enoughStudies          : k            >= MIN_STUDIES      (3)
enoughParticipants     : participants >= MIN_PARTICIPANTS (100)
acceptableHeterogeneity: iSquared != null AND iSquared < MAX_I_SQUARED (75%)
                         (a null / un-assessable I² FAILS — we cannot assert I² < 75%)
contradictionsResolved : openContradictions == 0
```

```
if sufficient                 -> STOP  (stop=true,  stop_reason="sufficient", no next step)
else                          -> STOP  (stop=true,  stop_reason="cap_reached") and PROPOSE
                                        exactly one concrete next refinement step
```

`MAX_ROUNDS = 3` is the bounded-search cap; this module evaluates one accrued round per
invocation, so it always terminates — it can only stop, and when still insufficient it
hands the caller the single concrete next step to take (honest insufficiency, never a
forced "good enough").

### Which refinement step (the `decide_next_step` boundary)

When the evidence is insufficient, the machine proposes exactly one refinement step,
chosen by a **fixed priority** over the failing criteria (no LLM). The three actions are
the autoresearch "propose" step re-targeted to evidence:

| First failing criterion | Refinement step | Meaning |
| --- | --- | --- |
| `enoughStudies` | `raise_limit` | **Sharpen the sub-question** — pull more candidate primary sources. |
| `enoughParticipants` | `add_facet` | **Widen the population** — larger trials / pooled cohorts (phase-3, multi-centre). |
| `acceptableHeterogeneity` | `add_facet` | Constrain population/comparator for a more homogeneous set. |
| `contradictionsResolved` | `broaden_query` | **Add an endpoint** — surface the adjudicating/resolving evidence the query is missing. |

### Where the open contradiction comes from

Unlike the sufficiency assessor, this loop also consumes the **effect-size directions**.
When some parsed effects are beneficial (ratio `< 1`) **and** some are harmful (ratio
`> 1`) in the same body, that directional disagreement is counted as exactly **one** open
contradiction (never inflated) — which fails the `contradictionsResolved` criterion and,
by priority, would drive a `broaden_query` refinement. This is a conflict a raw
study/participant count cannot see. An explicit `openContradictions` may also be supplied
to override the derived value.

---

## PaperTrail invariants it enforces

- **Deterministic + bounded** — no randomness, no network, no model, no GPU, no training.
  Same accrued stats → same gate → same stop/continue decision and same proposed next
  step, always. `MAX_ROUNDS` caps the search so it always terminates. Claude never touches it.
- **Honest insufficiency** — when the evidence is inadequate it stops with
  `stop_reason="cap_reached"` and `sufficient=false`, carrying the exact failing reasons
  and the concrete next step — never a forced low-confidence "sufficient".
- **Un-assessable heterogeneity fails** — a `null` I² is **not** treated as `< 75%`.
- **Drop, never coerce** — malformed input is rejected at the boundary: `sufficiency`
  must be an object with integer `k >= 0` and `participants >= 0`; `effect_sizes` (if
  present) is an array of `{point: number}`; `iSquared` is a number `>= 0` or `null`;
  `openContradictions` (if present) is an integer `>= 0`.
- **Boundary failure is explicit** — unreadable/invalid JSON or a structurally invalid
  payload is reported as `{"error": ...}` on stdout with exit code `2`, never a silent crash.

---

## Field-for-field mapping to the native TS agent

`lib/moa/agents/autoloop.ts` is the **Mixture-of-Agents** agent the app actually serves
from. It is a LAYER-3 deliberation voter that **composes** the MoA `sufficiency` artifact
(`{sufficient, reasons, k, participants}`) and the `effect_sizes` artifact
(`ParsedEffectSize[]`) off the shared blackboard, then runs the same bounded loop through
`lib/research/iterativeLoop.ts` (`planIterativeRounds`, which reuses
`lib/evidencePipeline.ts` `evidenceSufficiency`). It votes `neutral` when the loop is
stop-worthy and `insufficient` when the loop still needs more evidence.

| `papertrail_loop.py` | TS agent / lib |
| --- | --- |
| `MIN_STUDIES` / `MIN_PARTICIPANTS` / `MAX_I_SQUARED` | reused from `lib/evidencePipeline.ts` |
| `MAX_ROUNDS` | `MAX_ROUNDS` in `lib/research/iterativeLoop.ts` |
| `evidence_sufficiency` | reuses `evidenceSufficiency` (via `planIterativeRounds`) |
| `decide_next_step` | `decideWidenAction` / `deriveNextStep` (identical priority) |
| refine types `raise_limit` / `add_facet` / `broaden_query` | `WidenActionType` union (identical strings) |
| `open_contradictions_from` (effect directions) | `openContradictionsFrom` in `autoloop.ts` |
| output `stop` / `proposedNextStep` / `roundsCap` | agent `detail.{stop, proposedNextStep, roundsCap}` |

Output shape (JSON):

| `papertrail_loop.py` field | meaning |
| --- | --- |
| `stop` | whether the loop is stop-worthy this invocation |
| `proposedNextStep` | `{type, detail}` refinement action, or `null` when sufficient |
| `roundsCap` | `MAX_ROUNDS` (the bounded-search cap) |
| `sufficient` | whether all four sufficiency criteria pass |
| `stopReason` | `"sufficient"` or `"cap_reached"` |
| `criteria` | the four sufficiency booleans |
| `round` | `{k, participants, iSquared, openContradictions}` evaluated |
| `reasons` | the exact failing reasons from the gate |
| `effectDirections` | `{benefit, harm}` counts from the consumed effect sizes |

The `MIN_STUDIES` / `MIN_PARTICIPANTS` / `MAX_I_SQUARED` thresholds and `MAX_ROUNDS`
**must** stay identical to `lib/evidencePipeline.ts`, `lib/research/iterativeLoop.ts`, and
`backend/engines/open_deep_research/papertrail_iterative.py` — a drift would let the
offline Python loop and the on-demand TypeScript agent reach different continue/stop/refine
decisions from the same accrued stats.

---

## How to invoke

Standalone, stdlib only (no install):

```bash
# 1. Current accrued evidence on stdin — 1 study + a directional contradiction -> insufficient.
echo '{"sufficiency":{"k":1,"participants":40},
       "effect_sizes":[{"point":0.7},{"point":1.3}]}' \
  | python3 papertrail_loop.py

# 2. Inline via --arg — adequate body -> stop, no next step.
python3 papertrail_loop.py --arg '{"sufficiency":{"k":3,"participants":150},"iSquared":30}'

# 3. From a file.
python3 papertrail_loop.py --input-file state.json
```
