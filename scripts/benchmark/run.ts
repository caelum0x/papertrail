import "dotenv/config";
import { promises as fs, readFileSync } from "node:fs";
import path from "node:path";

import { z } from "zod";

import { benchmarkCaseArraySchema } from "@/lib/eval/benchmarkTypes";

import { callClaudeForJson } from "@/lib/claude";
import { ExtractedFindingSchema, VerificationResultSchema } from "@/lib/schemas";
import { groundVerificationResult } from "@/lib/grounding";
import { reconcile } from "@/lib/effectSize";
import { factCheck, isMiniCheckEnabled } from "@/lib/engines/minicheck";
import { orchestrate } from "@/lib/moa/orchestrate";

import type { BenchmarkCase, GoldLabel } from "@/lib/eval/benchmarkTypes";
import {
  computeMetrics,
  formatMetricsTable,
  type LabelPair,
  type MetricsSummary,
} from "@/lib/eval/metrics";
import { loadSample, loadScifact } from "@/scripts/benchmark/scifact";

// PaperTrail benchmark runner.
//
// Measures how well PaperTrail classifies scientific claims against their primary
// source, on the real SciFact dataset, against two baselines:
//
//   (1) PaperTrail — the real verification path: LLM extraction of a structured
//       finding, LLM verification/reasoning, and a DETERMINISTIC effect-size
//       reconcile (lib/effectSize) with span grounding (lib/grounding). No LLM is
//       in the numeric loop; the reconcile can only DEMOTE an "accurate" verdict to
//       a rule-decidable distortion, never invent one.
//   (2) Claude-alone — a single Claude call that classifies the claim vs the source
//       WITHOUT any deterministic engine, extraction step, or grounding.
//   (3) MiniCheck — optional entailment model (opt-in via MINICHECK_ENABLED);
//       supported -> SUPPORT, otherwise CONTRADICT. Skipped gracefully when off.
//
// Every case carries a gold SUPPORT | CONTRADICT | NEI label. We compute per-class
// precision/recall/F1 plus macro-F1, micro-F1, and accuracy for each system, print a
// comparison table, and write the results into docs/benchmark.md between the RESULTS
// markers (leaving the fixed METHODOLOGY section untouched).
//
// This is a dev/eval harness — NOT a deployed route. It defaults to a small committed
// sample (tests/fixtures/scifact-sample.json) so it runs on a fresh clone; --full reads
// the gitignored SciFact dev split under reference/ at eval time.
//
// Run:
//   npm run bench            # committed curated sample (offline data)
//   npm run bench -- --full  # full SciFact dev split from reference/ (gitignored)

// --- Verdict -> label mapping ------------------------------------------------

// PaperTrail's five discrepancy verdicts collapse onto the three SciFact labels:
//   accurate                       -> SUPPORT   (source supports the claim)
//   magnitude_overstated           -> CONTRADICT
//   population_overgeneralized     -> CONTRADICT
//   caveat_dropped                 -> CONTRADICT (each is a distortion the tool flagged)
//   no_support_found               -> NEI        (no confident support in the source)
const DISCREPANCY_TO_LABEL: Record<string, GoldLabel> = {
  accurate: "SUPPORT",
  magnitude_overstated: "CONTRADICT",
  population_overgeneralized: "CONTRADICT",
  caveat_dropped: "CONTRADICT",
  no_support_found: "NEI",
};

// --- (1) PaperTrail path -----------------------------------------------------

const EXTRACTION_SYSTEM = `You are a precise scientific data extraction assistant.
Given the text of a paper abstract or clinical record, extract ONLY what is
explicitly stated. Do not infer, generalize, or fill in gaps with typical values
from similar studies. If a field is not stated, use "not reported".
Respond with ONLY a single JSON object matching this shape, no other text:
{
  "effect_size": string,
  "population": string,
  "condition": string,
  "endpoint": string,
  "caveats": string[]
}`;

const VERIFICATION_SYSTEM = `You are a rigorous scientific claim auditor. You compare
a claim against the actual finding extracted from its PRIMARY source and classify
exactly how (if at all) the claim has drifted from that source.

Discrepancy types (judged against the PRIMARY source only):
- "accurate": the claim's direction, magnitude, population, and conditions are all
  consistent with the source (reasonable paraphrase is fine; distortion is not).
- "magnitude_overstated": the claim's effect is meaningfully larger/stronger than
  the source supports, OR the claim asserts the OPPOSITE direction of the source.
- "population_overgeneralized": the claim implies a broader population than studied.
- "caveat_dropped": the source has a material limitation the claim omits.
- "no_support_found": the claim is not meaningfully addressed by this source at all.

trust_score: 0-100, reflecting ONLY how well the claim matches the PRIMARY source.
90-100 = accurate. 60-89 = minor drift. 30-59 = meaningful distortion. 0-29 = major
distortion or unsupported.

Respond with ONLY a single JSON object, no other text:
{
  "discrepancy_type": "accurate" | "magnitude_overstated" | "population_overgeneralized" | "caveat_dropped" | "no_support_found",
  "trust_score": number,
  "explanation": string,
  "flagged_spans": [{ "claim_span": string, "source_span": string, "issue": string }],
  "cross_source_agreement": "single_source" | "corroborated" | "conflicting"
}
flagged_spans must be empty if discrepancy_type is "accurate". Every source_span must
be an exact substring of the PRIMARY source text provided — do not paraphrase it.`;

// The deterministic reconcile can only DEMOTE an LLM "accurate" verdict; it never
// upgrades. These are the reconcile verdicts that indicate a real distortion.
const RECONCILE_DISTORTION: Record<string, keyof typeof DISCREPANCY_TO_LABEL> = {
  magnitude_overstated: "magnitude_overstated",
  caveat_dropped: "caveat_dropped",
};

/**
 * Run the real PaperTrail verification path against one case's source text and map
 * the resulting verdict to a SUPPORT/CONTRADICT/NEI label. DB-free: extraction is done
 * inline (the production extractionAgent caches to Postgres, which the benchmark must
 * not require). The deterministic reconcile runs alongside the LLM and can only DEMOTE
 * an "accurate" verdict to a rule-decidable distortion — never invent one.
 */
async function runPaperTrail(sourceText: string, claim: string): Promise<GoldLabel> {
  // Step 1 — LLM extraction (no DB cache; this is an offline benchmark).
  const finding = await callClaudeForJson({
    system: EXTRACTION_SYSTEM,
    user: `Source text:\n\n${sourceText.slice(0, 12000)}`,
    schema: ExtractedFindingSchema,
    maxTokens: 700,
  });

  // Step 2 — LLM verification against the extracted finding + full source text.
  const rawVerdict = await callClaudeForJson({
    system: VERIFICATION_SYSTEM,
    user: `Claim to audit:\n"${claim}"\n\nExtracted finding from PRIMARY source:\n${JSON.stringify(
      finding,
      null,
      2
    )}\n\nFull PRIMARY source text (for locating exact source_span quotes):\n${sourceText.slice(
      0,
      8000
    )}`,
    schema: VerificationResultSchema,
    maxTokens: 1000,
  });

  // Step 3 — grounding invariant: drop any flagged span that isn't a verbatim
  // substring of the source (see lib/grounding.ts).
  const grounded = groundVerificationResult(rawVerdict, sourceText);

  // Step 4 — DETERMINISTIC reconcile (no LLM). It runs on the raw numbers in the
  // claim and source and can DEMOTE an LLM "accurate" verdict to a distortion, so an
  // overstated magnitude the model missed still gets caught. It never upgrades.
  let discrepancyType: string = grounded.discrepancy_type;
  if (discrepancyType === "accurate") {
    const rec = reconcile(claim, sourceText);
    const demoted = RECONCILE_DISTORTION[rec.verdict];
    if (demoted) discrepancyType = demoted;
  }

  return DISCREPANCY_TO_LABEL[discrepancyType] ?? "NEI";
}

// --- (2) Claude-alone baseline ----------------------------------------------

const claudeAloneSchema = z.object({
  label: z.enum(["SUPPORT", "CONTRADICT", "NEI"]),
});

const CLAUDE_ALONE_SYSTEM = `You are a scientific fact-checker. Decide whether a SOURCE
abstract SUPPORTS a claim, CONTRADICTS it, or provides NOT ENOUGH INFO to judge it.

- "SUPPORT": the source's evidence supports the claim.
- "CONTRADICT": the source's evidence contradicts or refutes the claim.
- "NEI": the source does not address the claim, or gives insufficient evidence to decide.

Respond with ONLY a single JSON object, no other text:
{ "label": "SUPPORT" | "CONTRADICT" | "NEI" }`;

/**
 * Baseline: a single Claude call classifying the claim vs the source WITHOUT the
 * deterministic engine, structured extraction, or grounding. This isolates what the
 * deterministic + grounding layers add over "just ask the model."
 */
async function runClaudeAlone(sourceText: string, claim: string): Promise<GoldLabel> {
  const out = await callClaudeForJson({
    system: CLAUDE_ALONE_SYSTEM,
    user: `Claim:\n"${claim}"\n\nSource:\n${sourceText.slice(0, 9000)}`,
    schema: claudeAloneSchema,
    maxTokens: 200,
  });
  return out.label;
}

// --- (3) MiniCheck baseline (optional) --------------------------------------

/**
 * MiniCheck is a binary entailment model: it returns "supported" or not for a
 * (claim, doc) pair. It has no CONTRADICT/NEI distinction, so "not supported" maps to
 * CONTRADICT (the conservative choice: an unsupported claim is treated as a distortion
 * the tool would flag, rather than silently passed as SUPPORT).
 */
async function runMiniCheck(sourceText: string, claim: string): Promise<GoldLabel> {
  const result = await factCheck({ pairs: [{ claim, doc: sourceText.slice(0, 12000) }] });
  const verdict = result.results[0];
  if (!verdict) return "NEI";
  return verdict.supported ? "SUPPORT" : "CONTRADICT";
}

// --- (4) Mixture of Agents (optional) ---------------------------------------

// Map the MoA's aggregate verdict onto the benchmark's 3-way label. A "mixed"
// (contested) verdict on an efficacy claim is driven by a real distortion the
// composition surfaced (e.g. the magnitude reconciler dissenting from the entailment
// vote), so it maps to CONTRADICT — the tool would flag it — rather than SUPPORT.
const MOA_VERDICT_TO_LABEL: Record<string, GoldLabel> = {
  supported: "SUPPORT",
  refuted: "CONTRADICT",
  mixed: "CONTRADICT",
  insufficient: "NEI",
};

/**
 * Run the full Mixture-of-Agents composition against one case's single source and map
 * the deterministic aggregate verdict to a SUPPORT/CONTRADICT/NEI label. This exercises
 * the whole DAG (enrichers -> verifiers incl. the deterministic magnitude reconciler ->
 * deliberation -> deterministic mix); the verdict is never LLM-decided.
 */
async function runMoA(sourceText: string, claim: string): Promise<GoldLabel> {
  const result = await orchestrate({
    claim,
    sources: [{ id: "s1", text: sourceText }],
  });
  return MOA_VERDICT_TO_LABEL[result.aggregate.verdict] ?? "NEI";
}

function isMoAEnabled(): boolean {
  return process.env.MOA_ENABLED === "true";
}

// --- System registry ---------------------------------------------------------

type Predictor = (sourceText: string, claim: string) => Promise<GoldLabel>;

interface SystemDef {
  name: string;
  predict: Predictor;
}

// --- Prediction loop ----------------------------------------------------------

interface RunOutcome {
  gold: GoldLabel[];
  predictions: Map<string, GoldLabel[]>;
  errorCounts: Map<string, number>;
}

/**
 * Predict a label for every case under every system, tolerating per-case failures
 * (a thrown LLM/subprocess error is recorded and the case is scored NEI for that
 * system — an honest "couldn't verify", never a fabricated pass). Nothing about the
 * claim or source text is logged; only the system name and a short error reason.
 */
async function predictAll(cases: BenchmarkCase[], systems: SystemDef[]): Promise<RunOutcome> {
  const gold: GoldLabel[] = [];
  const predictions = new Map<string, GoldLabel[]>();
  const errorCounts = new Map<string, number>();
  for (const s of systems) {
    predictions.set(s.name, []);
    errorCounts.set(s.name, 0);
  }

  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    gold.push(c.goldLabel);

    for (const s of systems) {
      let label: GoldLabel = "NEI";
      try {
        label = await s.predict(c.sourceText, c.claim);
      } catch (err: unknown) {
        errorCounts.set(s.name, (errorCounts.get(s.name) ?? 0) + 1);
        const msg = err instanceof Error ? err.message : "unknown error";
        process.stderr.write(
          `  [${s.name}] case ${i + 1}/${cases.length} (id=${c.id}) failed, scored NEI: ${msg}\n`
        );
      }
      predictions.get(s.name)!.push(label);
    }

    process.stdout.write(
      `\r  scored ${i + 1}/${cases.length} case(s)...${i + 1 === cases.length ? "\n" : ""}`
    );
  }

  return { gold, predictions, errorCounts };
}

// --- Scoring ------------------------------------------------------------------

interface SystemResult {
  name: string;
  summary: MetricsSummary<GoldLabel>;
  errors: number;
}

/** Pair gold + predicted labels and compute the full metrics summary for one system. */
function scoreSystem(name: string, gold: GoldLabel[], pred: GoldLabel[], errors: number): SystemResult {
  const pairs: LabelPair<GoldLabel>[] = gold.map((g, i) => ({ gold: g, pred: pred[i] }));
  return { name, summary: computeMetrics(pairs), errors };
}

function pct(x: number): string {
  return (x * 100).toFixed(1);
}

/**
 * Render the headline cross-system comparison: one row per system with accuracy,
 * macro-F1, and micro-F1. Pure string building — no I/O. The per-system per-class
 * breakdown + confusion matrix is rendered separately by formatMetricsTable.
 */
function formatComparison(results: readonly SystemResult[]): string {
  const lines: string[] = [];
  lines.push("| System | Accuracy | Macro-F1 | Micro-F1 | Errored (scored NEI) | N |");
  lines.push("| --- | ---: | ---: | ---: | ---: | ---: |");
  for (const r of results) {
    const { accuracy, macroF1, microF1, matrix } = r.summary;
    lines.push(
      `| ${r.name} | ${pct(accuracy)}% | ${pct(macroF1)}% | ${pct(microF1)}% | ${r.errors} | ${matrix.total} |`
    );
  }
  return lines.join("\n");
}

// --- docs/benchmark.md writing ----------------------------------------------

const RESULTS_START = "<!-- BENCH:RESULTS:START -->";
const RESULTS_END = "<!-- BENCH:RESULTS:END -->";

// Committed clinical-efficacy fixture — PaperTrail's DESIGN-TARGET task (efficacy-
// magnitude verification against a source), where recompute-from-registry actually
// applies. Self-consistent claim/source/gold triples using real, well-documented trial
// numbers (SPRINT, DAPA-HF, PARADIGM-HF, JUPITER, EMPA-REG). Validated at load.
const CLINICAL_FIXTURE_PATH = path.join(
  process.cwd(),
  "tests",
  "fixtures",
  "clinical-efficacy.json"
);

function loadClinicalEfficacy(): BenchmarkCase[] {
  const raw = JSON.parse(readFileSync(CLINICAL_FIXTURE_PATH, "utf8")) as unknown;
  return benchmarkCaseArraySchema.parse(raw);
}

/**
 * Splice a fresh RESULTS block between the RESULTS markers in docs/benchmark.md,
 * leaving the fixed METHODOLOGY section untouched. If the file or markers are missing,
 * we log and skip rather than clobber anything — the console table stays authoritative.
 */
async function writeResults(block: string, docsPath: string): Promise<void> {
  let existing: string;
  try {
    existing = await fs.readFile(docsPath, "utf8");
  } catch {
    process.stderr.write(
      `\n[warn] ${docsPath} not found; skipping results write (console output above is authoritative).\n`
    );
    return;
  }

  const startIdx = existing.indexOf(RESULTS_START);
  const endIdx = existing.indexOf(RESULTS_END);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    process.stderr.write(
      `\n[warn] RESULTS markers not found in ${docsPath}; skipping results write.\n`
    );
    return;
  }

  const before = existing.slice(0, startIdx + RESULTS_START.length);
  const after = existing.slice(endIdx);
  const next = `${before}\n\n${block}\n\n${after}`;
  await fs.writeFile(docsPath, next, "utf8");
  process.stdout.write(`Wrote results to ${docsPath}\n`);
}

/** Build the markdown RESULTS block: run metadata, comparison table, per-system detail. */
function buildResultsBlock(
  datasetLabel: string,
  caseCount: number,
  results: readonly SystemResult[]
): string {
  const lines: string[] = [];
  lines.push("### Latest run", "");
  lines.push(`- Dataset: **${datasetLabel}** (${caseCount} case(s))`);
  lines.push(`- Generated: ${new Date().toISOString()}`);
  lines.push("");
  lines.push("#### Headline comparison", "");
  lines.push(formatComparison(results));
  lines.push("");
  lines.push("#### Per-system breakdown", "");
  for (const r of results) {
    lines.push(formatMetricsTable(r.summary, { title: r.name }));
    lines.push("");
  }
  return lines.join("\n");
}

// --- CLI ---------------------------------------------------------------------

interface Cli {
  full: boolean;
  clinical: boolean;
}

function parseArgs(argv: readonly string[]): Cli {
  return { full: argv.includes("--full"), clinical: argv.includes("--clinical") };
}

function requireApiKey(): void {
  if (!process.env.ANTHROPIC_API_KEY) {
    process.stderr.write(
      [
        "",
        "ANTHROPIC_API_KEY is not set.",
        "",
        "The benchmark runs live Claude calls for the PaperTrail and Claude-alone",
        "systems. Add your key to .env.local (see .env.example) and re-run:",
        "",
        "  ANTHROPIC_API_KEY=sk-ant-... npm run bench",
        "",
      ].join("\n") + "\n"
    );
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const cli = parseArgs(process.argv.slice(2));
  requireApiKey();

  const datasetLabel = cli.clinical
    ? "Clinical-efficacy claims (committed, PaperTrail's design task)"
    : cli.full
      ? "SciFact dev (full, reference/)"
      : "SciFact curated sample (committed)";
  // The clinical run writes to its own doc so it never clobbers the SciFact results.
  const docsPath = path.join(
    process.cwd(),
    "docs",
    cli.clinical ? "benchmark-clinical.md" : "benchmark.md"
  );
  process.stdout.write(`\nPaperTrail benchmark — ${datasetLabel}\n`);

  // Loaders are synchronous and validate every case with Zod at load. BENCH_LIMIT caps
  // the number of cases (useful for a cheap smoke run); unset = the full set.
  const benchLimit = process.env.BENCH_LIMIT ? Number(process.env.BENCH_LIMIT) : undefined;
  const loaded: BenchmarkCase[] = cli.clinical
    ? loadClinicalEfficacy()
    : cli.full
      ? loadScifact({ split: "dev" })
      : loadSample();
  const cases: BenchmarkCase[] = loaded.slice(
    0,
    Number.isFinite(benchLimit) && (benchLimit as number) > 0 ? benchLimit : undefined
  );
  if (cases.length === 0) {
    process.stderr.write("No benchmark cases loaded; aborting.\n");
    process.exit(1);
  }
  process.stdout.write(`Loaded ${cases.length} case(s).\n\n`);

  const systems: SystemDef[] = [
    { name: "PaperTrail", predict: runPaperTrail },
    { name: "Claude-alone", predict: runClaudeAlone },
  ];

  if (isMiniCheckEnabled()) {
    systems.push({ name: "MiniCheck", predict: runMiniCheck });
    process.stdout.write("MiniCheck enabled (MINICHECK_ENABLED=true).\n");
  } else {
    process.stdout.write("MiniCheck disabled (set MINICHECK_ENABLED=true to include it).\n");
  }
  if (isMoAEnabled()) {
    systems.push({ name: "Mixture of Agents", predict: runMoA });
    process.stdout.write("Mixture of Agents enabled (MOA_ENABLED=true).\n");
  } else {
    process.stdout.write("Mixture of Agents disabled (set MOA_ENABLED=true to include it).\n");
  }
  process.stdout.write("\n");

  const { gold, predictions, errorCounts } = await predictAll(cases, systems);

  const results: SystemResult[] = systems.map((s) =>
    scoreSystem(s.name, gold, predictions.get(s.name)!, errorCounts.get(s.name) ?? 0)
  );

  process.stdout.write("\n" + formatComparison(results) + "\n\n");
  for (const r of results) {
    process.stdout.write(formatMetricsTable(r.summary, { title: r.name }) + "\n\n");
  }

  await writeResults(buildResultsBlock(datasetLabel, cases.length, results), docsPath);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : "unknown error";
  process.stderr.write(`\nBenchmark failed: ${msg}\n`);
  process.exit(1);
});
