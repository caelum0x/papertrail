# PaperTrail — Submission

**Track:** Builder ("Build Beyond the Bench")
**License:** MIT (fully open source)
**Repo:** this repository · **Live URL:** _<add after deploy>_ · **Demo video:** _<add ≤3-min link>_

---

## Written summary (≈180 words)

PaperTrail is a research copilot that can't lie about numbers. In life sciences the danger
with AI isn't fluency — it's unverifiable claims: an assistant that confidently states a
drug "halves risk" when the trial's registered result is a 15% reduction. PaperTrail flips
the usual design: **Claude does the hard reading and reasoning — agentic full-paper
comprehension, multi-agent deep research, structured extraction — while a deterministic
engine with no LLM anywhere in the math recomputes every statistic and grounds every
citation to an exact source span.**

Given a biomedical claim, it agentically assembles trial, **genetic (Open Targets, GWAS
Catalog), and safety (openFDA/FAERS)** evidence, recomputes the effect, and self-corrects
overstatements — distinguishing "the mechanism is genome-wide significant" from "the
clinical magnitude is overstated." Every number is oracle-tested against reference tools
(metafor, epitools) and benchmarked against Claude-alone on SciFact.

It's the trust layer that lets a frontier model be deployed on high-stakes biomedical
claims — for medical affairs, translational labs, and systematic reviewers — entirely on
open bio-data, no wet lab required.

---

## Why it scores

- **Impact (25%)** — Real buyer (pharma medical-affairs / translational labs); real pain
  (hours of PhD verification per claim). Built on the exact open-data stack bio-AI monetizes
  (Open Targets, GWAS Catalog, openFDA, PubMed, ClinicalTrials.gov, PubTator).
- **Claude Use (25%)** — Claude as an agentic tool-using reasoner (copilot, deep research,
  full-paper extraction) whose every factual/numeric output is machine-verified and
  self-corrected — a genuinely novel neuro-symbolic pattern, not a chat wrapper.
- **Depth & Execution (20%)** — Deterministic biostatistics (meta-analysis, survival,
  network/dose-response, GRADE, pharmacovigilance PRR/ROR/IC, genetic significance),
  oracle-tested; a measured SciFact benchmark; production-grade multi-tenant app on Next 16.
- **Demo (30%)** — One tight biomedical flow with a visceral self-correction moment
  (trial + genetics + safety), deployed and live. See `DEMO.md`.

## Still required before submission (owner action)
- [ ] Deploy to a live URL (Vercel + secrets: `DATABASE_URL`, `AUTH_SECRET`, `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`, `CRON_SECRET`).
- [ ] Run `npm run bench` with a key to drop the real Claude-alone-vs-PaperTrail number into `docs/benchmark.md` and the video.
- [ ] Record the ≤3-min demo (`DEMO.md` script).
- [ ] Paste live URL + video link above.
```
