# PaperTrail specialization of MiniCheck

`papertrail_negation.py` in this directory is a **PaperTrail-native specialization** of the
MiniCheck engine. This repo owns the vendored MiniCheck tree; rather than fork or fight the
upstream pipeline, we added one file that ports MiniCheck's entailment check into a
**negation-aware** form that handles ABSENCE claims and satisfies PaperTrail's moat rules,
mirroring the TypeScript contract in `lib/grounding/negationEntailment.ts`.

**No other file in this engine is modified.** `papertrail_negation.py` is standalone,
stdlib-only Python (no MiniCheck install, no network, no model download), and this whole
directory is excluded from the Next build — so there is zero TypeScript/build impact.

---

## Why it exists

Upstream MiniCheck (Tang, Laban & Durrett, EMNLP 2024) answers exactly one question with a
trained model — see `minicheck/utils.py`:

> `SYSTEM_PROMPT`: "Determine whether the provided claim is consistent with the corresponding
> document. Consistency ... implies that all information presented in the claim is
> substantiated by the document. ... respond with either 'Yes' or 'No'."

That gives `MiniCheck(document, claim) -> supported | unsupported` (our port of that step is
`lib/grounding/entailment.ts`). It has a blind spot PaperTrail must not have: **ABSENCE
claims**. Consider:

> "Drug X does **NOT** cause hepatotoxicity"

This claim is **supported** by a source showing **absence** ("no significant difference in ALT
elevation vs placebo") and **refuted** by a source showing **presence** ("Drug X caused
dose-dependent hepatotoxicity"). A vanilla consistency check conflates the two: it reads the
source's mention of hepatotoxicity as topical overlap and can wrongly call the negative claim
"supported", or, seeing the very effect the claim denies, wrongly call it "refuted". **The
polarity of the claim flips the meaning of every support signal**, and MiniCheck's single Yes/No
never models that.

PaperTrail's **moat rule** is: *no LLM in the polarity / numeric / label path.* So this file
adds the negation-aware layer MiniCheck lacks and makes it deterministic: it decides the
claim's polarity from a fixed negation-cue lexicon and maps `(polarity x source_assertion)` to
a final label by a FIXED table. The only step a language model may perform is the
polarity-**neutral** judgement "does the source assert PRESENCE, ABSENCE, or NEITHER of this
effect?" — and even that only counts once its supporting sentence is grounded verbatim.

| MiniCheck step | `papertrail_negation.py` |
| --- | --- |
| trained model: `consistency(document, claim) -> Yes/No` | polarity-**neutral** model step (upstream): `source_assertion -> presence \| absence \| neither` + verbatim supporting sentence |
| *(no polarity model)* — a negative claim is judged like any other | `detect_polarity()` — deterministic negation-cue lexicon decides `positive \| negative`, **no model** |
| single `Yes/No` verdict (the model decides) | `map_label()` — FIXED `(polarity x assertion)` table decides `supported \| negative_supported \| refuted \| nei`, **no model** |
| support asserted, not grounded | `locate_span()` grounds the supporting sentence; ungroundable support is **dropped** and the verdict falls back to `nei` |

---

## What it computes (all deterministic)

1. **Polarity** — `detect_polarity(claim)`: whole-token, case-insensitive match against
   `NEGATION_CUES`. Any cue present -> `negative` (claim denies its effect), else `positive`.
   The cues that matched are returned as evidence for the decision.
2. **Label** — `map_label(polarity, source_assertion)` via the fixed table:

   |                    | source: presence | source: absence      | source: neither |
   | ------------------ | ---------------- | -------------------- | --------------- |
   | **positive** claim | `supported`      | `refuted`            | `nei`           |
   | **negative** claim | `refuted`        | `negative_supported` | `nei`           |

   `negative_supported` is a **distinct** verdict (not folded into `supported`) so downstream
   consumers see that an ABSENCE claim was confirmed by evidence of ABSENCE.
3. **Grounding** — `locate_span()` (Tier 1 exact, Tier 2 whitespace-normalized with an offset
   map back to the verbatim source substring) is a stdlib port of `lib/grounding.ts`
   `locateSpan`. A `presence`/`absence` supporting sentence that cannot be located is dropped;
   the verdict falls back to `nei`, `score` is zeroed, and `grounding_dropped` is set.

Every constant and rule is FIXED and **identical** to `lib/grounding/negationEntailment.ts`,
so the Python engine is an exact by-hand cross-check of the TS hot path.

---

## PaperTrail invariants it enforces

- **Deterministic** — no model calls, no network in this file. Same input -> same output.
  (The neutral presence/absence judgement is performed upstream and passed in as `judgement`.)
- **Groundable** — the supporting sentence is located verbatim in the source or dropped; this
  file never invents a span, mirroring `lib/grounding.ts`.
- **Honest abstention** — no groundable support, or a `neither` source, or no `judgement`
  supplied -> `nei` rather than a forced label. Honest-insufficient over a forced answer.
- **No LLM in the verdict** — polarity, the label table, and every number are decided by rule;
  a language model only produces the polarity-neutral presence/absence judgement upstream.

---

## Field-for-field mapping to the native TS module

`papertrail_negation.py` mirrors `lib/grounding/negationEntailment.ts`:

| `papertrail_negation.py` | `lib/grounding/negationEntailment.ts` |
| --- | --- |
| `NEGATION_CUES` | `NEGATION_CUES` (identical list + whole-token matching) |
| `detect_polarity()` -> `(polarity, cues)` | `detectPolarity()` -> `{ polarity, cues }` |
| `_LABEL_TABLE` / `map_label()` | `LABEL_TABLE` / `mapLabel()` |
| `locate_span()` / `_normalize_with_offsets()` | `locateSpan()` (imported from `lib/grounding.ts`) |
| `verify_absence_claim(payload)` | `verifyAbsenceClaim(input, deps)` |
| output `polarity` | `VerifyAbsenceResult.polarity` |
| output `negation_cues` | `VerifyAbsenceResult.negation_cues` |
| output `source_assertion` | `VerifyAbsenceResult.source_assertion` |
| output `label` | `VerifyAbsenceResult.label` |
| output `score` | `VerifyAbsenceResult.score` |
| output `supporting_span {text,start,end,status}` | `VerifyAbsenceResult.supporting_span { text, grounding: { status, start, end } }` |
| output `grounding_dropped` | `VerifyAbsenceResult.grounding_dropped` |

The TS module additionally owns the **model step** (the neutral presence/absence judgement),
reusing the `lib/grounding/entailment.ts` Claude pattern; the Python module accepts that
judgement as input so the deterministic layer is testable stdlib-only. The public route is
`app/api/verify/absence-claim/route.ts` (`POST { claim, source_text }`).

Labels are consumed by TS as the union `supported | negative_supported | refuted | nei`.

---

## How to run

```bash
# negative claim confirmed by evidence of ABSENCE -> negative_supported
python papertrail_negation.py --json '{
  "claim": "Drug X does not cause hepatotoxicity",
  "source_text": "There was no significant difference in ALT elevation between Drug X and placebo.",
  "judgement": {
    "source_assertion": "absence",
    "confidence": 0.85,
    "supporting_sentence": "no significant difference in ALT elevation between Drug X and placebo"
  }
}'

# polarity detection alone (omit "judgement") -> deterministic, no model needed
python papertrail_negation.py --json '{
  "claim": "Drug X does not cause hepatotoxicity",
  "source_text": "..."
}'
```

Prints one JSON object mirroring `VerifyAbsenceResult`
(`polarity`, `negation_cues`, `source_assertion`, `label`, `score`, `supporting_span`,
`grounding_dropped`). On bad input it prints `{"error": "..."}` to stdout and exits with
code 2.
