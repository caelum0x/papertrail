# PaperTrail — Build Mindset (single source of truth)

Every workflow/agent building PaperTrail follows this. When in doubt, re-read.

## The goal
Not an MVP, not a demo, not a narrow wedge. The **full, feature-complete AI research
platform** — "the final Facebook, not Facebook v1." Go big on product, features,
capabilities, and overall app. Completeness and scale ARE the signal.

## Why (the win condition)
Target: "Built with Claude: Life Sciences" (Anthropic × Gladstone), elite field. Anthropic
puts up API credits + prizes to seed a **real production-grade app that will consume Claude at
scale** and showcase their mission: frontier AI deployed *safely* in a high-stakes, regulated
domain. A judge should look at it and think *"this is obviously a real platform at scale — give
them the credits, they clearly need them."*

## The three non-negotiables
1. **Claude is the high-volume CORE.** Claude does the genuinely hard work — agentic full-paper
   reading, structured extraction where regex fails, multi-step synthesis, long-form generation,
   conversational tool-use over the whole platform, continuous re-analysis. NOT thin commodity
   RAG. If a feature could be built without Claude, that's a smell — push Claude deeper.
2. **The deterministic engine is the TRUST LAYER that ENABLES heavy Claude use** — not a thing
   that keeps Claude out. Every Claude output touching a number or a factual claim is verified /
   grounded by the existing deterministic engines (grounding.ts, effectSize, structuredVerification,
   metaAnalysis, grade, etc.). This is the ONLY reason a regulated org would deploy an LLM here at
   scale. More Claude, safely.
3. **Production-grade, real app.** Multi-tenant, RBAC, audit, rate-limited, tested, CI, deployable.
   Every new capability is a real feature with pages + APIs + persistence, not a script.

## Inspiration (borrow pages/APIs/architecture/features)
See docs/competitive-landscape.md + docs/oss-inspiration.md. North stars: Elicit / Consensus
(assistant + evidence tables), PaperQA2 (agentic paper QA with citations), STORM (long-form cited
synthesis), ASReview (active-learning screening), Scite (smart citations), Causaly (knowledge
graph). Adopt their best patterns; verify everything with our engine.

## Engineering rules (unchanged)
- Reuse lib/claude.ts (getClaude, CLAUDE_MODEL, callClaudeForJson) for all Claude calls; validate
  every structured Claude output against a Zod schema before use.
- Ground every Claude factual/numeric claim to an exact source span; drop what can't be grounded.
- Public compute routes: nodejs, rate-limited, envelope, never log claim text. Org routes: withOrg
  + requireRole + writeAudit, org_id first predicate, never trust client org_id.
- Pure/immutable numeric logic; small focused files; explicit error handling.
- Code-first: ship complete working features; minimal oracle test per new engine, not big suites.
