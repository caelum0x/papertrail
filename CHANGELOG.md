# Changelog

All notable changes to PaperTrail are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

This cycle turned PaperTrail from a single-claim verifier into a deterministic
evidence-synthesis platform. All numeric logic is pure and oracle-tested; no LLM
sits in the numeric loop. The Claude API is used only for extraction/grounding at
the text boundary, never for computing effect sizes, weights, or scores.

### Added

- **Meta-analysis engine** (`lib/metaAnalysis.ts`, `app/api/synthesis`): pooled
  fixed- and random-effects (DerSimonian–Laird) estimation with heterogeneity
  statistics (Q, I², τ²) and per-study/pooled confidence intervals.
- **Effect-size core** (`lib/effectSize.ts`): risk ratio, odds ratio, risk
  difference, and standardized/mean-difference conversions with variances.
- **Survival analysis** (`lib/survival.ts`, `lib/survivalCurves.ts`,
  `app/api/survival`): Kaplan–Meier estimation, log-rank testing, and Cox
  proportional-hazards hazard ratios for time-to-event outcomes.
- **Network meta-analysis** (`lib/networkMeta.ts`, `app/api/network-meta`):
  multi-treatment indirect comparison with a connected-evidence check.
- **Meta-regression** (`lib/metaRegression.ts`, `app/api/meta-regression`):
  moderator regression on study-level covariates to explain heterogeneity.
- **Continuous-outcome meta-analysis** (`lib/continuousMeta.ts`,
  `app/api/continuous-meta`): pooling of means/SDs across studies.
- **Subgroup analysis** (`lib/subgroupAnalysis.ts`, `app/api/subgroup`):
  stratified pooling with a between-subgroups heterogeneity test.
- **Publication-bias assessment** (`lib/publicationBias.ts`): funnel-plot
  asymmetry, Egger's test, and Duval–Tweedie trim-and-fill adjustment.
- **GRADE certainty grading** (`lib/grade.ts`): caller-supplied risk-of-bias,
  indirectness, and publication-bias steps (0..2 each) combined with
  auto-derived imprecision/inconsistency domains to a final certainty rating.
- **Absolute effects** (`lib/absoluteEffects.ts`): translation of relative
  effects into absolute risk given a baseline risk, for Summary-of-Findings rows.
- **Evidence report** (`lib/evidenceReport.ts`, `lib/evidenceReportBatch.ts`,
  `app/api/evidence-report`, `app/api/evidence-reports`): end-to-end assembly of
  a claim + studies into a graded, citation-backed report, with persistence and
  a batch path for multiple claims.
- **Evidence Workbench UI**: interactive synthesis workspace, including a
  `ForestPlot` component for pooled visualization.
- **Report export** (`lib/evidenceReportExport.ts`, `lib/reportExport.ts`,
  `lib/reportExportHtml.ts`, `lib/csvExport.ts`, `lib/citationFormats.ts`):
  Summary-of-Findings / evidence-report export to HTML and CSV with formatted
  citations.
- **Auto-synthesis** (`lib/autoSynthesis.ts`): `extractStudyFromSource` and
  `autoSynthesize` build a synthesis directly from cached sources, wired through
  `app/api/auto-synthesis`.
- **Background scheduler + health** (`app/api/cron/tick`, `app/api/health`,
  `lib/jobs`): Vercel Cron entry point that sweeps every org's due schedules and
  runnable jobs behind a `CRON_SECRET` bearer token, plus a public `/api/health`
  liveness/readiness probe that pings the DB and reports key presence.
- **Continuous integration** (`.github/workflows/ci.yml`): type-check, test, and
  build on every push and pull request to `main`.
- **Deploy guide** (`docs/deploy.md`): required env vars, cron/`CRON_SECRET`
  setup, migrations, and the health check.

### Changed

- **`/api/verify`** now returns GRADE certainty alongside the verification
  verdict, so a single claim carries an explicit confidence rating.
- Public compute routes share one contract: `nodejs` runtime, rate limiting via
  `lib/rateLimit`, and a `success`/`data`/`error` envelope from `lib/api/response`.

### Fixed

- Statistical routines reuse the shared `lib/stats/distributions` primitives
  instead of re-implementing normal/χ² tail functions, removing divergent
  numeric behavior across engines.
- Retrieval returns `discrepancy_type: 'no_support_found'` below the similarity
  threshold rather than forcing a low-confidence match.
