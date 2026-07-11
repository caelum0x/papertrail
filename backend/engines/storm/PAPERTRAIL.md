# PaperTrail specialization of STORM (structured debate)

`papertrail_debate.py` in this directory is a **PaperTrail-native specialization** of the
STORM engine. This repo owns the vendored STORM tree; rather than fork or run upstream's
LLM-driven research conversation, we added one file that borrows STORM's **shape** — a
multi-perspective debate — and re-implements it as a **deterministic evidence assembler**
for PaperTrail's MIXED-verdict case. It **ORGANIZES** the provided evidence; it does not
invent.

**No other file in this engine is modified.** `papertrail_debate.py` is standalone,
stdlib-only Python (no `dspy`, no `torch`, no STORM install, no model download, no
network), and this whole directory is excluded from the Next build — so there is zero
TypeScript/build impact.

---

## Why it exists

When PaperTrail verifies a claim and finds that **some sources support it and some refute
it**, a single flat "trust score" hides the disagreement — exactly the situation a
translational-research lab most needs to see laid bare. STORM's insight is that a good
survey of a contested topic is *multi-perspective*: it argues both sides before
synthesizing. PaperTrail adopts that shape for the mixed verdict and produces a
four-section **debate skeleton**:

1. **Claim** — the claim under scrutiny, verbatim.
2. **Best-Case-For** — the strongest *supporting* evidence, ranked (the "proponent").
3. **Critique** — the strongest *refuting* evidence, ranked (the "critic").
4. **Synthesis** — a stance (`balanced_mixed` / `leans_supported` / `leans_refuted` /
   `one_sided` / `insufficient`) computed **from the counts alone**.

Upstream STORM (`knowledge_storm/storm_wiki/modules/knowledge_curation.py`,
`interface.py: Conversation`) drives this with an LLM persona conversation. PaperTrail's
**moat rule** is: *no LLM, and no non-reproducible numeric path, anywhere in a
verdict/score/ranking loop.* So this file keeps the debate structure and drops the black
box:

| STORM (LLM-driven) | `papertrail_debate.py` |
| --- | --- |
| Persona/expert conversation curates perspectives | Fixed two-perspective frame: proponent (supporting) vs critic (refuting) |
| LLM decides what to surface and emphasize | `_score_snippet()` — a **fixed pattern heuristic** ranks evidence; no model |
| LLM writes the synthesis / takes a position | `_compute_stance()` — stance computed **from counts alone**; no LLM |
| Free-form generated prose may drift from sources | Every quote is a **substring the caller provided**; TS mirror grounds it verbatim |

Fixed ranking constants (`MAX_QUOTES_PER_SIDE=5`, `STANCE_MARGIN_THRESHOLD=2`) and the
`_STAT_PATTERNS` table are the reproducibility contract — they are duplicated **verbatim**
in `lib/synthesis/debate.ts`, so the Python assembler and the on-demand TypeScript mirror
order the same evidence the same way and reach the same stance for the same input.

---

## PaperTrail invariants it enforces

- **Deterministic** — ranking is by a fixed pattern score (`_score_snippet`), tie-broken
  by id then original order; the stance is a pure function of the two counts. Same input →
  same debate, byte-for-byte. There is **no LLM** in any score, rank, count, or stance.
  Claude never touches this path (and in the TS mirror only ever writes connective prose).
- **Organizes, never invents** — every emitted quote is a substring the caller supplied.
  This module trusts its already-vetted snippet inputs; the TS mirror
  (`lib/synthesis/debate.ts`) additionally **grounds** each quote against the real source
  text via `lib/grounding.locateSpan` and **drops** any that can't be located.
- **Honest insufficiency** — if one side is empty the stance is `one_sided`; if both are
  empty it is `insufficient`. A snippet with empty/whitespace text is **dropped** (counted
  in `dropped_empty`), never coerced into a fake quote. We prefer an honest "not a real
  debate" over a forced synthesis.
- **Boundary failure is explicit** — unreadable/invalid JSON input is reported as
  `{"error": ...}` on stdout with exit code `2`, never a silent crash.

---

## Field-for-field mapping to `lib/synthesis/debate.ts`

The app serves this feature from the TypeScript mirror `buildDebate` (called by
`POST /api/synthesis/debate`). The Python module is the offline/CLI twin with identical
numeric behavior. The mapping:

### Functions / constants

| `papertrail_debate.py` | `lib/synthesis/debate.ts` |
| --- | --- |
| `MAX_QUOTES_PER_SIDE`, `STANCE_MARGIN_THRESHOLD` | `MAX_QUOTES_PER_SIDE`, `STANCE_MARGIN_THRESHOLD` (verbatim) |
| `_STAT_PATTERNS` | `STAT_PATTERNS` (same patterns + weights) |
| `_score_snippet` | `scoreSnippet` (length-capped base + fixed bonuses, rounded 6dp) |
| `_compute_stance` | `computeStance` (identical count logic → same stance strings) |
| `_rank_side` | `rankSide` (score desc, id asc, order asc; truncate; 1-based rank) |
| `_parse_side` / `_parse_input` | `BuildDebateInputSchema` / `DebateSnippetSchema` (Zod boundary) |
| `build_debate` | `buildDebate` |
| — (trusts pre-vetted snippets) | `groundSide` + `lib/grounding.locateSpan` (verbatim grounding; drops ungroundable → `droppedUngrounded`) |
| — | optional Claude **prose only** (`PROSE_SYSTEM`) — never a score/rank/stance |

### Input shape

Python stdin / `--input-file` JSON and the route's `POST` body are the **same shape**:

```json
{
  "claim": "Drug X reduced cardiovascular events by 30%",
  "supporting": [{ "id": "s1", "text": "events fell by 30% (p<0.001), n=1200" }],
  "refuting":   [{ "id": "r1", "text": "no significant difference was observed" }]
}
```

### Output shape

| Python output field | `DebateResult` field (TS) |
| --- | --- |
| `claim` | `claim` |
| `sections.claim.text` | `sections.claim.text` |
| `sections.best_case_for.quotes[].{id,text,rank,score}` | `sections.bestCaseFor.quotes[].{id,text,rank,score}` (+ `sourceId`, `grounding`) |
| `sections.critique.quotes[].{id,text,rank,score}` | `sections.critique.quotes[].{id,text,rank,score}` (+ `sourceId`, `grounding`) |
| `sections.synthesis.{stance,supporting_count,refuting_count,margin}` | `sections.synthesis.{stance,supportingCount,refutingCount,margin}` (+ `note` prose) |
| `supporting_count` / `refuting_count` | `supportingCount` / `refutingCount` |
| `dropped_empty` (empty-text snippets dropped) | `droppedUngrounded` (snippets that couldn't be **grounded** in a source) |

The Python `dropped_empty` and the TS `droppedUngrounded` play the same *auditability*
role — "how much evidence did we honestly refuse to use" — but at different rigor: Python
drops empty snippets (it trusts pre-vetted text); the TS mirror drops any snippet whose
text is not a locatable substring of a real source, which is the stronger PaperTrail
guarantee actually served to users.

---

## How to invoke

Standalone, stdlib only (no install):

```bash
# 1. Debate request as JSON on stdin.
echo '{"claim":"Drug X cut events 30%",
       "supporting":[{"id":"s1","text":"events fell by 30% (p<0.001)"}],
       "refuting":[{"id":"r1","text":"no significant difference was observed"}]}' \
  | python3 papertrail_debate.py

# 2. Debate request from a file.
python3 papertrail_debate.py --input-file debate.json
```

### Extending / tuning

If you change any ranking constant (`MAX_QUOTES_PER_SIDE`, `STANCE_MARGIN_THRESHOLD`) or
the `_STAT_PATTERNS` table you **must** change it identically in `lib/synthesis/debate.ts`
— the two blocks are the reproducibility contract, and drift between them would let the
offline assembler and the on-demand route disagree on ordering or stance.
