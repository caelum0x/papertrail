# PaperTrail MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io) server that exposes
**PaperTrail's deterministic evidence-verification engine** as tools. Add it to
**Anthropic Claude Science** as a Connector and a scientist can, in-session, say
_"verify this efficacy claim against its registry"_ or _"run a random-effects
meta-analysis on these trials"_ and get a sourced, deterministic answer.

The server is a thin, standalone npm package. It calls the **deployed PaperTrail
API over HTTP** — it imports no application code, ships no database, and holds no
secrets beyond an optional org API key. Every response is the engine's, not the
model's.

## What it is

- **Standalone package** under `mcp/`, ESM, TypeScript compiled to `dist/`.
- Talks to the live PaperTrail deployment (default
  `https://papertrail-topaz-phi.vercel.app`) and unwraps the standard
  `{ success, data, error }` envelope for you.
- Groups ~50 tools across five domains: verification, evidence synthesis,
  biomedical intelligence, research, and org-scoped workflows.

## Environment variables

| Variable              | Required            | Default                                      | Purpose                                                                 |
| --------------------- | ------------------- | -------------------------------------------- | ----------------------------------------------------------------------- |
| `PAPERTRAIL_BASE_URL` | No                  | `https://papertrail-topaz-phi.vercel.app`    | Point the server at a different deployment (e.g. staging or localhost). |
| `PAPERTRAIL_API_KEY`  | Only for org tools  | _(none)_                                     | Org API key sent as `Authorization: Bearer <key>` for org-scoped tools. |

Only the org-scoped tools (`structure_experiment`, `match_patient_to_trials`)
need `PAPERTRAIL_API_KEY`. All other tools work anonymously against the public
API.

## Build and run

```bash
cd mcp
npm install
npm run build          # tsc -> dist/
node dist/server.js    # start the stdio server (or: npm start)
```

The server speaks MCP over stdio. It prints a single startup banner to **stderr**
(stdout is reserved for the protocol) and otherwise stays quiet.

To point at a local PaperTrail dev server:

```bash
PAPERTRAIL_BASE_URL=http://localhost:3000 node dist/server.js
```

## Adding it to Claude Science

See [`claude-science/README.md`](./claude-science/README.md) for a copy-paste
Connector configuration and a `.mcp.json`-style example.

## Tool catalogue

Every tool returns a human-readable summary followed by the full JSON payload.
Unless noted, tools are read-only and reach external registries
(`openWorldHint`).

### Verification (`tools/verification.ts`)

| Tool                    | Endpoint                    | What it does                                                        |
| ----------------------- | --------------------------- | ------------------------------------------------------------------ |
| `verify_claim`          | `/api/verify`               | Verify one efficacy claim against its primary source.              |
| `verify_claim_batch`    | `/api/verify/batch`         | Verify many claims at once.                                        |
| `verify_text_claims`    | `/api/verify/text`          | Extract and verify every checkable claim in a passage.            |
| `meta_crosscheck`       | `/api/meta-crosscheck`      | Cross-check a claim against multiple sources for agreement.        |
| `scientific_claim_eval` | `/api/scieval`              | Structured scientific-claim evaluation.                            |
| `fact_check_pipeline`   | `/api/factcheck`            | End-to-end fact-check pipeline for a claim.                        |
| `fact_check_document`   | `/api/fact-check`           | Fact-check an entire document.                                     |
| `classify_citation`     | `/api/citations/classify`   | Classify a citation's rhetorical/support role.                    |
| `audit_guideline`       | `/api/guideline-audit`      | Audit a clinical guideline statement against evidence.            |
| `draft_with_evidence`   | `/api/drafting`             | Draft prose with inline, verified evidence.                        |

### Evidence synthesis (`tools/synthesis.ts`)

| Tool                        | Endpoint                   | What it does                                              |
| --------------------------- | -------------------------- | -------------------------------------------------------- |
| `meta_analysis`             | `/api/synthesis`           | Random/fixed-effects meta-analysis of effect sizes.      |
| `continuous_meta_analysis`  | `/api/continuous-meta`     | Meta-analysis for continuous outcomes (mean differences).|
| `network_meta_analysis`     | `/api/network-meta`        | Network meta-analysis across multiple treatments.        |
| `meta_regression`           | `/api/meta-regression`     | Meta-regression on study-level moderators.               |
| `subgroup_analysis`         | `/api/subgroup`            | Subgroup analysis with between-group tests.              |
| `survival_analysis`         | `/api/survival`            | Time-to-event / survival synthesis.                      |
| `dose_response_analysis`    | `/api/dose-response`       | Dose-response modelling.                                 |
| `trial_sequential_analysis` | `/api/trial-sequential`    | Trial sequential analysis (monitoring boundaries).       |
| `risk_of_bias`              | `/api/risk-of-bias`        | Risk-of-bias assessment for studies.                     |
| `evidence_report`           | `/api/evidence-report`     | Generate a structured evidence report.                   |
| `evidence_pipeline`         | `/api/evidence-pipeline`   | Run the full evidence-synthesis pipeline.                |
| `effect_size_stats`         | `/api/stats`               | Effect-size and summary statistics.                      |

### Biomedical intelligence (`tools/biomedical.ts`)

| Tool                        | Endpoint                        | What it does                                          |
| --------------------------- | ------------------------------- | ----------------------------------------------------- |
| `bio_verify_claim`          | `/api/bio/verify-claim`         | Verify a biomedical claim against curated databases.  |
| `bio_safety_signal`         | `/api/bio/safety-signal`        | Pharmacovigilance safety-signal detection.            |
| `bio_genetic_association`   | `/api/bio/genetic-association`  | Gene-disease / trait association evidence.            |
| `bio_target_disease`        | `/api/bio/target-disease`       | Target-disease association scoring.                   |
| `bio_bioactivity`           | `/api/bio/bioactivity`          | Compound bioactivity lookup (ChEMBL-style).           |
| `bio_variant_pathogenicity` | `/api/bio/variant-pathogenicity`| Variant pathogenicity assessment.                     |
| `bio_pharmacogenomics`      | `/api/bio/pharmacogenomics`     | Pharmacogenomic gene-drug guidance.                   |
| `bio_annotate_entities`     | `/api/bio/annotate`             | Normalize/annotate biomedical entities in text.       |
| `bio_drug_interaction`      | `/api/bio/drug-interaction`     | Drug-drug interaction check.                           |
| `bio_repurposing`           | `/api/bio/repurposing`          | Drug-repurposing candidate evidence.                  |
| `bio_biomarker`             | `/api/bio/biomarker`            | Biomarker validation evidence.                         |

### Research (`tools/research.ts`)

| Tool                      | Endpoint                   | What it does                                             |
| ------------------------- | -------------------------- | ------------------------------------------------------- |
| `paper_qa`                | `/api/paper-qa`            | Grounded question-answering over a paper.               |
| `deep_research`           | `/api/deep-research`       | Multi-source deep-research report.                      |
| `research_brief`          | `/api/research`            | Concise research brief on a topic.                      |
| `research_gaps_hypotheses`| `/api/hypotheses`          | Surface research gaps and testable hypotheses.          |
| `extract_paper`           | `/api/extraction/paper`    | Structured extraction from a paper.                     |
| `assemble_mechanism`      | `/api/mechanism`           | Assemble a mechanistic pathway from evidence.           |
| `synthesis_report`        | `/api/synthesis-report`    | Narrative synthesis report.                             |
| `knowledge_graph`         | `/api/graph`               | Build/query a biomedical knowledge graph.               |
| `kg_link_predict`         | `/api/kg/predict`          | Knowledge-graph link prediction.                        |
| `extract_entities`        | `/api/entities`            | Extract entities from text.                             |
| `hybrid_retrieval`        | `/api/retrieval/hybrid`    | Hybrid (semantic + lexical) retrieval.                  |
| `evidence_dossier`        | `/api/dossier`             | Compile an evidence dossier.                            |
| `real_world_evidence`     | `/api/rwe`                 | Real-world-evidence summary.                            |

### Org-scoped workflows (`tools/orgScoped.ts`) — require `PAPERTRAIL_API_KEY`

| Tool                       | Endpoint                  | What it does                                              |
| -------------------------- | ------------------------- | -------------------------------------------------------- |
| `structure_experiment`     | `/api/v1/lab-notebook`    | Structure free-text lab notes into an experiment record. |
| `match_patient_to_trials`  | `/api/v1/trial-matcher`   | Match a patient description to eligible clinical trials.  |

## Package layout

```
mcp/
├── package.json            # standalone npm package (bin: papertrail-mcp)
├── tsconfig.json           # ES2022 / NodeNext / strict
├── README.md               # this file
├── claude-science/         # Connector config for Claude Science
└── src/
    ├── client.ts           # HTTP client, envelope unwrap, timeout, Bearer auth
    ├── registry.ts         # PaperTrailTool contract + tool()/format helpers
    ├── server.ts           # McpServer over stdio; registers every tool
    └── tools/
        ├── verification.ts # verificationTools
        ├── synthesis.ts    # synthesisTools
        ├── biomedical.ts   # biomedicalTools
        ├── research.ts     # researchTools
        └── orgScoped.ts    # orgScopedTools
```

## License

Apache-2.0.
