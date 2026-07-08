# 2026 Built with Claude: Life Sciences — Participant Guide

Official all-in-one resource: schedule, rules, technical resources, problem
statements, judging, and submission info. Source:
https://cerebralvalley.ai/e/built-with-claude-life-sciences

> **PaperTrail = Builder Track.** See strategic notes at the bottom of this file.

## 1. Community

- **Discord:** https://anthropic.com/discord — a custom role grants access to
  hackathon channels. Ping `@CV` in `#hackathon-access` if the Hackathon
  Participant role doesn't arrive within a few hours.
- **Socials:** Use the provided hero image on X and LinkedIn.

## 2. Schedule (all times ET)

- **Tue Jul 7**
  - 12:00 PM — Virtual Kickoff (rules, prizes, judging, technical talks)
  - 12:30 PM — Hacking begins; team formation on Discord
  - 5:00–6:00 PM — Anthropic office hours (`#office-hours`)
- **Wed Jul 8**
  - 12:00–1:00 PM — Live Session One: Overview of Claude Science with
    Alexander Tarashansky (Member of Technical Staff, Anthropic)
  - 5:00–6:00 PM — Anthropic office hours
- **Thu Jul 9**
  - 5:00–6:00 PM — Anthropic office hours
- **Fri Jul 10**
  - 12:00–1:00 PM — Live Session Two: "From genome to inference without touching
    a pipette" with Sukrit Silas (Assistant Investigator, Gladstone Institutes)
  - 5:00–6:00 PM — Anthropic office hours
- **Sat Jul 11 / Sun Jul 12** — Hacking continues
- **Mon Jul 13**
  - **9:00 PM — SUBMISSIONS DUE via CV platform** ← hard deadline
- **Tue Jul 14 / Wed Jul 15** — First round judging
- **Thu Jul 16**
  - 12:00 PM — Final Round Judging; Top 6 teams announced (`#announcements`)
  - 1:30 PM — Closing Ceremony; Top 3 revealed

## 3. Rules

- **Open Source:** Everything submitted must be open-sourced under an approved
  open-source license.
- **New Work Only:** All projects must be started from scratch during the
  hackathon with no previous work. (Researchers: an existing question + public
  datasets is fine, but the analysis must happen during the event.)
- **Team Size:** Up to 2 members.
- **Banned Projects:** Disqualified if they violate legal/ethical/platform
  policies, or use code/data/assets you don't have rights to.

## 4. Problem Statements & Example Projects

### [Researcher Track] Build From the Bench
Using Claude Science, start from a biological question, find existing datasets
and tools to answer it, and submit something discrete — a finding, a trained
model, a reproducible analysis. Optional Gladstone datasets:
- New drug targets in CD4+ T cell Perturb-seq data (Alex Marson's lab).
- Predict what a noncoding variant does to chromatin (Ryan Corces's lab;
  ChromBPNet on ENCODE ATAC-seq).
- Deeply conserved / rapidly-changed human genome regions (Katie Pollard's
  Zoonomia constraint scores + Human Accelerated Regions).

### [Builder Track] Build Beyond the Bench  ← **OUR TRACK**
Using Claude Code, start from a user you can name — a scientist, a lab, a clinic,
a biotech — and build the tool they're missing: working software they could use
without you in the room, built to outlast the week. Optional idea seeds:
- A lab-notebook companion turning bench voice memos into structured records.
- A clinical-trial matcher from free-text patient notes, showing
  inclusion/exclusion reasoning per match.
- A pipeline translator wrapping a CLI analysis pipeline in a bench-friendly UI.

## 5. Anthropic-Provided Resources

**Quickstarts:** Claude Science Get Started · Claude Code Quickstart · Claude API
Quickstart · Claude Models Overview
**Docs:** Claude Science · Claude Code · Claude API · MCP · Agent Skills
**Key blogs:** Claude Science announcement · Claude Code Best Practices ·
Building Effective Agents · Building Agents with the Claude Agent SDK · Building
multi-agent systems · Prompt-engineering best practices · Effective Context
Engineering · Extending Claude with skills & MCP · Skills explained · Building
agents with Skills · Configuring hooks
**Courses:** Claude Code in Action · Agent Skills with Anthropic · Claude Code
Courses GitHub
**Other:** Claude Quickstarts repo · Claude Science product overview · Guide to
Building Skills (eBook) · Claude Cookbooks (+ GitHub) · Agent Skills GitHub

## 6. Judging — two stages

### Stage 1 — Asynchronous (Jul 14–15)
Judges independently review submissions on standardized criteria. Each team
uploads: (1) ≤3-min demo video, (2) open-source repo/notebook/write-up,
(3) 100–200 word summary. Aggregated scores pick the **Top 3 per track**.

**Criteria & weights:**
1. **Impact — 25%.** Real-world potential. Who benefits, how much does it matter?
   Builder: could this become something people *use*? Fits the track's problem
   statement?
2. **Claude Use — 25%.** How *creatively* did the team use Claude Code? Beyond a
   basic application? Did they surface capabilities that surprised even us?
3. **Depth & Execution — 20%.** Did the team push past the first idea? Sound,
   refined engineering — real craft, not a quick hack?
4. **Demo — 30%.** Is it a working, compelling demo? Does it hold up as software
   you could actually use? Is it genuinely cool to watch?

### Stage 2 — Final Round Live (Thu Jul 16, 12:00 PM ET)
Pre-recorded demos (3 min/team) played live; judges deliberate. Winners,
runners-up, and special-prize winners announced at the 1:30 PM closing ceremony.

## 7. Submission

- 3-minute demo video (YouTube, Loom, or similar)
- GitHub repository / notebook / research write-up
- Written description / summary (100–200 words)
- **Deadline: Mon Jul 13, 9:00 PM ET**
- Must be built entirely during the hackathon; no pre-existing work.

## 8. Prizes

**Research Track (usage credits):** 1st $30k · 2nd $10k · 3rd $5k
**Builder Track (API credits):** 1st $30k · 2nd $10k · 3rd $5k  ← **OUR TRACK**
**Gladstone Institutes Award ($10k usage credits):** the *research* project with
the most potential to advance the field, hand-selected by Gladstone.

Questions: `#questions` or ping the moderators.

---

## Strategic Notes for PaperTrail (Builder Track)

**Deadline math:** Build window is now (Tue Jul 7, 12:30 PM ET) → **Mon Jul 13,
9:00 PM ET**. That's ~6 days. The deliverable is not just the deployed app — it's
**a 3-min demo video + open-source repo + 100–200 word summary.** Budget a full
day for the video; a great tool with a rushed video loses to a good tool with a
sharp one.

**Judging leverage (what to optimize):**
- **Demo (30%) is the single biggest bucket.** "Working, compelling, cool to
  watch, holds up as software you could use." → Lock 2 bulletproof examples
  (one clear catch, one confirmed-accurate) against pre-ingested sources so it
  never depends on live API latency. This is already in `CLAUDE.md` priority #7.
- **Claude Use (25%) rewards going *beyond a basic application*.** A single
  extract-then-compare prompt reads as "basic." Lean into the multi-agent chain
  (retrieval → extraction → verification) as a deliberate design, and consider
  one genuinely creative Claude use that "surprises" judges — e.g. the
  exact-substring `flagged_spans` grounding (no unsourced claims about the
  source) is a strong, demoable trust mechanism. Show the reasoning trail.
- **Impact (25%):** Name the user out loud — a Gladstone-style translational
  researcher checking 50+ citations under grant-deadline pressure. Tie demo
  claims to Gladstone's own disease areas (heart failure, neurodegeneration).
- **Depth & Execution (20%):** The production-hardening checklist in `CLAUDE.md`
  (rate limiting, health check, error states, no leaked keys) *is* the "real
  craft, not a quick hack" evidence. Keep it green.

**Two hard compliance rules — verify before submitting:**
1. **New Work Only.** The repo must be started-from-scratch during the event.
   All current files are dated Jul 7 (event day) — good. Do NOT import
   pre-hackathon code. When we `git init`, the first commit should be dated
   within the event window.
2. **Open Source.** Repo must be public under an approved OSS license. A
   `LICENSE` file already exists — confirm it's an approved license (MIT/Apache
   2.0 are safe) before submission.
