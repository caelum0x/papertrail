# PaperTrail Skills for Claude Science

Plain-language **Agent Skills** that wrap the PaperTrail evidence-verification
engine so a scientist can reach it in Claude Science without knowing endpoints,
payloads, or statistics libraries. Each skill's `description` is what the model
matches on — say what you want in natural language and the right skill loads.

Every skill routes to the exact same deterministic engine two ways: the
**PaperTrail MCP connector** (preferred) or a **curl fallback** against the live
API for when the connector isn't installed.

## Why these are trustworthy

All skills carry PaperTrail's hard guarantees through to the scientist:

- **Deterministic recompute** — the numbers (verdicts, pooled effects, PRR/ROR,
  association scores) come from fixed engines, not model sampling. Same input,
  same result.
- **Exact-span grounding** — every claim about a source maps to a verbatim
  substring / character offset of the cached source text. No unsourced
  assertions.
- **Honest `no_support_found`** — when the evidence isn't there, the tools say
  so instead of fabricating a confident answer.

## The skills

| Skill | What it does | Primary tool(s) | Endpoint(s) |
| --- | --- | --- | --- |
| [`papertrail-verify-claim`](./papertrail-verify-claim/SKILL.md) | Verify one efficacy/magnitude claim against its primary source | `verify_claim` | `/api/verify` |
| [`papertrail-evidence-synthesis`](./papertrail-evidence-synthesis/SKILL.md) | Pool studies into a meta-analysis with a GRADE report | `meta_analysis`, `evidence_report` | `/api/synthesis`, `/api/evidence-report` |
| [`papertrail-trial-matcher`](./papertrail-trial-matcher/SKILL.md) | Match de-identified patient notes to eligible trials | `match_patient_to_trials` | `/api/v1/trial-matcher` (auth) |
| [`papertrail-lab-notebook`](./papertrail-lab-notebook/SKILL.md) | Structure rough bench notes into a reproducible record | `structure_experiment` | `/api/v1/lab-notebook` (auth) |
| [`papertrail-safety-signal`](./papertrail-safety-signal/SKILL.md) | Pharmacovigilance PRR/ROR from FDA FAERS | `bio_safety_signal` | `/api/bio/safety-signal` |
| [`papertrail-target-disease`](./papertrail-target-disease/SKILL.md) | Target-disease evidence + genetic association | `bio_target_disease`, `bio_genetic_association` | `/api/bio/target-disease`, `/api/bio/genetic-association` |
| [`papertrail-research-brief`](./papertrail-research-brief/SKILL.md) | Grounded deep-research brief with citations | `deep_research`, `paper_qa` | `/api/deep-research`, `/api/paper-qa` |
| [`papertrail-research-gaps`](./papertrail-research-gaps/SKILL.md) | Grounded research gaps + testable hypotheses | `research_gaps_hypotheses` | `/api/hypotheses` |

## Installing in Claude Science (Capabilities → Skills)

1. **Add the PaperTrail connector (recommended).** In Claude Science, go to
   **Settings → Connectors** and add the PaperTrail MCP server (see
   [`../mcp/claude-science/README.md`](../mcp/claude-science/README.md) for the
   copy-paste config). Set `PAPERTRAIL_BASE_URL` (default
   `https://papertrail-topaz-phi.vercel.app`), and `PAPERTRAIL_API_KEY` only if
   you need the org-scoped skills (`papertrail-trial-matcher`,
   `papertrail-lab-notebook`).
2. **Install the skills.** Go to **Capabilities → Skills** and add each skill
   folder in this directory. Each is a self-contained `skills/<name>/SKILL.md`;
   upload the folder (or zip it) so the frontmatter `name` and `description`
   register.
3. **Use plain language.** Ask e.g. "verify that semaglutide cut MACE by 20%"
   or "pool these three trials and give me a GRADE table." Claude matches your
   request to the skill `description` and runs the underlying tool.

### No connector installed?

Every skill also documents a **curl fallback** against the live API. The
public skills need no key; the two org-scoped skills need
`Authorization: Bearer $PAPERTRAIL_API_KEY`. All responses use the standard
`{ success, data, error }` envelope — the engine's answer lives under `data`.

## Conventions

- Skill folder name is kebab-case and matches the frontmatter `name` exactly.
- The `description` states **what** the skill does and **when** to use it —
  that one line is the model's routing signal, so keep it specific.
- Skill bodies name the **exact** canonical MCP tool and its inputs, then give
  the curl fallback. Tool names here match the PaperTrail MCP server so skills
  and server always agree.
