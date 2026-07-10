# PaperTrail — 3-Minute Demo Script (Builder Track)

> Judging is Demo 30% · Claude Use 25% · Impact 25% · Depth 20%. This script is built
> to score all four in three minutes, with one visceral "wow" moment. Record ≤ 3:00.
> Run the app in `MOCK_MODE=true` for the locked examples so nothing depends on live
> API latency or secrets during recording (see `.env.example`).

## The one-line pitch
**PaperTrail is the research copilot that can't lie about numbers.** Claude reads and
reasons over the literature; a deterministic engine recomputes every statistic and
grounds every citation — so a frontier model can be deployed on high-stakes biomedical
claims *safely*, at scale.

## Named user (Builder track)
A pharma **medical-affairs reviewer** / translational lab (Gladstone-style) who must sign
off that an efficacy or mechanism claim is actually supported before it ships — today that
is hours of PhD time per claim.

---

## Shot list

**[0:00–0:20] The problem (hook).**
On screen: a slick AI "research assistant" confidently writing *"PCSK9 inhibition halves
cardiovascular risk; the genetic evidence is definitive."*
VO: "Every AI research tool sounds this confident. The problem in biology isn't fluency —
it's that you can't trust the number. Overstated claims are how good science goes wrong."

**[0:20–0:40] The turn.**
VO: "So we built the opposite: an assistant where Claude does the hard reading and
reasoning, and a deterministic engine — no LLM anywhere in the math — guarantees every
number and every citation. Watch what happens to that same claim."

**[0:40–1:50] THE HERO FLOW (the wow).** Live in the app.
1. Paste the claim into the **Research Copilot** / **Evidence Pipeline**.
2. Claude agentically pulls three kinds of evidence, on screen as a tool trace:
   - **Trial** — the primary CVD outcomes trial (registered result).
   - **Genetics** — Open Targets + GWAS Catalog for *PCSK9 → coronary artery disease*.
   - **Safety** — FAERS disproportionality for the drug class.
3. The deterministic engine recomputes and a **red banner fires**:
   > ⚠️ **Corrected.** Claude's draft said *"halves risk."* The registered primary result
   > is **HR 0.85 (~15% relative reduction)** — `overstates_registry`. Rewritten to ~15%.
4. But — and this is the PhD-grade nuance — a **green panel**:
   > ✓ **Mechanism confirmed.** *PCSK9–coronary artery disease* is **genome-wide
   > significant** (p < 5×10⁻⁸, Open Targets genetic score shown). The *biology* is real;
   > only the clinical *magnitude* was overstated.
VO: "An AI that self-corrects — and reasons across trial, genetic, and safety evidence to
separate 'the mechanism is real' from 'the magnitude is overstated.' Every number is
sourced; nothing is fabricated."

**[1:50–2:25] Claude Use + Depth (fast montage).**
- Claude tool-use agent driving verify / synthesize / retrieve.
- Full-paper agentic reading → structured PICO + effect extraction.
- Multi-agent **Deep Research** (plans sub-questions → evidence per question → cited report).
- The moat: **deterministic biostatistics, oracle-tested** to metafor/epitools (meta-analysis,
  survival, PRR/ROR, genetic significance) — and **benchmarked vs. Claude-alone on SciFact**
  (`npm run bench`).
VO: "Claude does the reasoning a PhD would. The engine is the trust layer that makes it
deployable — and we measured the lift."

**[2:25–2:50] Impact.**
VO: "This is what bio-AI actually sells: cited, auditable answers on the open bio-data
stack — Open Targets, GWAS Catalog, openFDA, PubTator, PubMed, ClinicalTrials.gov — no
proprietary wet-lab data required. For medical affairs, translational labs, and systematic
reviewers, it turns hours of verification into seconds, with a defensible trail."

**[2:50–3:00] Close.**
On screen: the GitHub repo (MIT) + the live URL.
VO: "PaperTrail. Open source. The research copilot that can't lie about numbers."

---

## Recording checklist
- [ ] `MOCK_MODE=true` (or a seeded DB with the locked example cached) so the hero flow is instant.
- [ ] Pre-load the one biomedical claim; rehearse the single wow beat (the red→green banners).
- [ ] Keep it under 3:00. Do NOT tour 17 features — show ONE flow deeply.
- [ ] End on the live URL + repo.
```
