# PaperTrail specialization of open_deep_research (Iterative Research Loop)

`papertrail_iterative.py` in this directory is a **PaperTrail-native specialization** of
the open_deep_research (ODR) engine. This repo owns the vendored ODR tree; rather than
fork or run upstream's LangGraph supervisor, we added one file that re-implements ODR's
**iterative research loop** — plan → research → *decide whether to continue* → widen —
as a **deterministic state machine** that makes the continue/stop decision with
field-standard thresholds instead of an LLM.

**No other file in this engine is modified.** `papertrail_iterative.py` is standalone,
stdlib-only Python (no LangGraph, no ODR install, no model download, no network), and
this whole directory is excluded from the Next build — so there is zero
TypeScript/build impact.

---

## Why it exists

Upstream ODR's supervisor (`open_deep_research`'s `supervisor` / `should_continue`
routing) runs a loop: it fans out `ConductResearch` units, compresses the results, and
then asks an **LLM** whether the accrued research is enough to write the final report or
whether it should research more. That loop-control decision is made by a model.

PaperTrail's **moat rule** is: *no LLM, and no non-reproducible path, anywhere in a
score / ranking / verdict — **including a loop-control decision**.* Deciding "do we have
enough evidence to conclude, or should we run another retrieval pass?" is exactly such a
decision. So this file keeps ODR's iterative *structure* but replaces the LLM
`should_continue` with a **deterministic sufficiency gate** over numbers the
deterministic engines already produced.

| ODR step | `papertrail_iterative.py` |
| --- | --- |
| supervisor fans out `ConductResearch`, accrues evidence | caller supplies accrued per-round stats `{k, participants, iSquared?, openContradictions?}` |
| LLM `should_continue` (continue researching vs. write report) | `evidence_sufficiency` — **deterministic** four-criterion gate (no LLM) |
| "research more" branch (next research pass) | `decide_widen_action` — one concrete widen action (`raise_limit` / `add_facet` / `broaden_query`) |
| recursion depth / `max_researcher_iterations` | `MAX_ROUNDS` hard cap — the loop always terminates |
| "write report" branch | `stop` with `stop_reason = sufficient` |

---

## The boundary that decides continue vs. stop

The loop is decided **entirely** by `plan_iterative_rounds(rounds)` (Python) /
`planIterativeRounds(rounds)` (TS). Each round runs the **same** sufficiency gate the
rest of PaperTrail uses (`evidence_sufficiency` here; `evidenceSufficiency` in
`lib/evidencePipeline.ts`), which passes only when **all four** field-standard criteria
hold:

```
enoughStudies          : k            >= MIN_STUDIES      (3)
enoughParticipants     : participants >= MIN_PARTICIPANTS (100)
acceptableHeterogeneity: iSquared != null AND iSquared < MAX_I_SQUARED (75%)
                         (a null / un-assessable I² FAILS — we cannot assert I² < 75%)
contradictionsResolved : openContradictions == 0
```

Per round the state machine is:

```
if sufficient                 -> STOP  (stop_reason = "sufficient")
elif a further round remains  -> CONTINUE  (emit ONE widen action for the next round)
else (cap reached / no more)  -> STOP  (stop_reason = "cap_reached")   # honest insufficiency
```

`MAX_ROUNDS = 3` caps the loop: the last supplied round — or the 3rd round, whichever
comes first — can only stop, never continue, so the machine always terminates.

### Which widen action (the `decide_widen_action` boundary)

When a round is insufficient **and** another round remains, the machine emits exactly one
concrete widen action, chosen by a **fixed priority** over the failing criteria (no LLM):

| First failing criterion | Widen action | Why |
| --- | --- | --- |
| `enoughStudies` | `raise_limit` | Pull more candidate primary sources into the next pass. |
| `enoughParticipants` | `add_facet` | Target larger trials / pooled cohorts (phase-3, multi-centre). |
| `acceptableHeterogeneity` | `add_facet` | Constrain population/comparator for a more homogeneous set. |
| `contradictionsResolved` | `broaden_query` | Surface the adjudicating/resolving evidence the query is missing. |

This is pure rules over the gate's `criteria` — **no LLM** picks the continue/stop
decision or the widen action.

---

## PaperTrail invariants it enforces

- **Deterministic** — no randomness, no network, no model. Same per-round stats → same
  gate results → same continue/stop/widen decisions, always. There is **no LLM** in the
  loop-control path. Claude never touches it.
- **Honest insufficiency** — when the round cap is hit while still insufficient, the loop
  **stops** with `stop_reason = "cap_reached"` and `final.sufficient = false`, carrying
  the exact failing reasons — never a forced low-confidence "sufficient".
- **Un-assessable heterogeneity fails** — a `null` I² is **not** treated as `< 75%`; the
  heterogeneity criterion honestly fails, mirroring `evidenceSufficiency`.
- **Guaranteed termination** — `MAX_ROUNDS` caps the walk; extra supplied rounds beyond
  the cap are ignored (`meta.rounds_supplied` still reports how many were given).
- **Drop, never coerce** — malformed input is rejected at the boundary: `rounds` must be
  a non-empty array; each round needs integer `k >= 0` and `participants >= 0`; `iSquared`
  is a number `>= 0` or `null`; `openContradictions` is an integer `>= 0` (default `0`).
- **Boundary failure is explicit** — unreadable/invalid JSON or a structurally invalid
  payload is reported as `{"error": ...}` on stdout with exit code `2`, never a silent
  crash.

---

## Field-for-field mapping to the native TS module

`lib/research/iterativeLoop.ts` is the **TypeScript mirror** the app actually serves from.
It **reuses** `evidenceSufficiency` from `lib/evidencePipeline.ts` (which it does **not**
edit) for the gate, and adds the state machine + widen boundary on top — mirroring how
this Python file re-implements that same gate.

| `papertrail_iterative.py` | `lib/research/iterativeLoop.ts` |
| --- | --- |
| `MIN_STUDIES` / `MIN_PARTICIPANTS` / `MAX_I_SQUARED` | reused from `lib/evidencePipeline.ts` (`MIN_STUDIES` / `MIN_PARTICIPANTS` / `MAX_I_SQUARED`) |
| `MAX_ROUNDS` | `MAX_ROUNDS` |
| `evidence_sufficiency` | reuses `evidenceSufficiency` from `lib/evidencePipeline.ts` |
| `decide_widen_action` | `decideWidenAction` |
| `plan_iterative_rounds` | `planIterativeRounds(rounds, opts?)` |
| widen types `raise_limit` / `add_facet` / `broaden_query` | `WidenActionType` union (identical strings) |
| stop reasons `sufficient` / `cap_reached` | `StopReason` union (identical strings) |

Output shape (identical field-for-field, snake_case in Python / camelCase in TS):

| Python JSON field | TS `IterativePlan` field |
| --- | --- |
| `rounds[].round` | `rounds[].round` |
| `rounds[].sufficient` | `rounds[].sufficient` |
| `rounds[].decision` | `rounds[].decision` (`"continue" \| "stop"`) |
| `rounds[].reason` | `rounds[].reason` |
| `rounds[].widen_action` (`{type, detail}` or `null`) | `rounds[].widenAction` (`WidenAction \| null`) |
| `rounds[].criteria` | `rounds[].criteria` (same four booleans) |
| `final.decision` | `final.decision` (always `"stop"`) |
| `final.stop_reason` | `final.stopReason` |
| `final.rounds_used` | `final.roundsUsed` |
| `final.sufficient` | `final.sufficient` |
| `meta.max_rounds` | `meta.maxRounds` |
| `meta.rounds_supplied` | `meta.roundsSupplied` |

The public route `app/api/deep-research/iterative/route.ts` (runtime `nodejs`, IP
`checkRateLimit`, Zod `safeParse`, `ok`/`fail` envelope, try/catch, logs ids/counts only)
accepts `POST { rounds: [{k, participants, iSquared?, openContradictions?}] }` and returns
the `IterativePlan`.

---

## How to invoke

Standalone, stdlib only (no install):

```bash
# 1. Rounds as JSON on stdin — reach sufficiency on round 2, stop.
echo '{"rounds":[{"k":1,"participants":40,"iSquared":null,"openContradictions":0},
                 {"k":3,"participants":120,"iSquared":48,"openContradictions":0}]}' \
  | python3 papertrail_iterative.py

# 2. Inline via --arg.
python3 papertrail_iterative.py --arg '{"rounds":[{"k":3,"participants":150,"iSquared":30}]}'

# 3. From a file.
python3 papertrail_iterative.py --input-file rounds.json
```

### Extending / tuning

`MIN_STUDIES`, `MIN_PARTICIPANTS`, `MAX_I_SQUARED`, and `MAX_ROUNDS` are the
reproducibility contract. `MIN_STUDIES` / `MIN_PARTICIPANTS` / `MAX_I_SQUARED` **must**
stay identical to the constants in `lib/evidencePipeline.ts`, and `MAX_ROUNDS` **must**
stay identical to `MAX_ROUNDS` in `lib/research/iterativeLoop.ts` — a drift between the two
would let the offline Python loop and the on-demand TypeScript loop reach different
continue/stop/widen decisions from the same per-round stats.
```
