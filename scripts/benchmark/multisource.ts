import "dotenv/config";
import { promises as fs, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

import { callClaudeForJson } from "@/lib/claude";
import { orchestrate } from "@/lib/moa/orchestrate";
import {
  computeMetrics,
  formatMetricsTable,
  type LabelPair,
} from "@/lib/eval/metrics";

// Multi-source, contested-evidence benchmark — the FAIR test of the Mixture of Agents.
// Unlike the single-source clinical set, each case gives the verifier SEVERAL sources
// (real conflicting or replicating trials), so the composing agents that give the MoA its
// edge actually fire: MiniCheck labels each source, MultiVerS aggregates the labels, the
// extractor's effect sizes feed PyMARE's pool, Valsci's contested set feeds STORM's debate.
//
// The differentiator cases are aggregate reversals — a lone positive source outweighed by
// larger/definitive null-or-harm trials (niacin, intensive BP in diabetics, HRT, beta-
// carotene), and an over-generalized class claim refuted by one class member (SGLT2). A
// reader fixating on one supportive abstract says SUPPORT; integrating the sources says
// otherwise. Claude-alone sees the same concatenated sources, so this isolates whether the
// COMPOSITION reasons over the totality better than one model call.

type GoldLabel = "SUPPORT" | "CONTRADICT" | "NEI";

const CaseSchema = z.object({
  id: z.string(),
  claim: z.string(),
  sources: z.array(z.object({ id: z.string(), text: z.string() })).min(1),
  goldLabel: z.enum(["SUPPORT", "CONTRADICT", "NEI"]),
});
const FixtureSchema = z.array(CaseSchema);
type MultiSourceCase = z.infer<typeof CaseSchema>;

const FIXTURE_PATH = path.join(process.cwd(), "tests", "fixtures", "clinical-multisource.json");
const DOCS_PATH = path.join(process.cwd(), "docs", "benchmark-multisource.md");

function loadCases(): MultiSourceCase[] {
  const raw = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as unknown;
  return FixtureSchema.parse(raw);
}

// --- (1) Mixture of Agents ----------------------------------------------------

const MOA_VERDICT_TO_LABEL: Record<string, GoldLabel> = {
  supported: "SUPPORT",
  refuted: "CONTRADICT",
  mixed: "CONTRADICT",
  insufficient: "NEI",
};

async function runMoA(c: MultiSourceCase): Promise<GoldLabel> {
  const result = await orchestrate({ claim: c.claim, sources: c.sources });
  return MOA_VERDICT_TO_LABEL[result.aggregate.verdict] ?? "NEI";
}

// --- (2) Claude-alone baseline (same concatenated sources) --------------------

const claudeAloneSchema = z.object({ label: z.enum(["SUPPORT", "CONTRADICT", "NEI"]) });

const CLAUDE_ALONE_SYSTEM = `You are a scientific fact-checker. You are given a CLAIM and
SEVERAL sources (which may agree or disagree). Judge the claim against the TOTALITY of the
evidence, not any single source.

- "SUPPORT": the body of evidence supports the claim.
- "CONTRADICT": the body of evidence contradicts or fails to support the claim (e.g. the
  larger/definitive trials show no effect or harm, or the claim over-generalizes).
- "NEI": the sources do not address the claim, or are too sparse to judge.

Respond with ONLY a single JSON object: { "label": "SUPPORT" | "CONTRADICT" | "NEI" }`;

async function runClaudeAlone(c: MultiSourceCase): Promise<GoldLabel> {
  const joined = c.sources.map((s, i) => `Source ${i + 1} (${s.id}):\n${s.text}`).join("\n\n");
  const out = await callClaudeForJson({
    system: CLAUDE_ALONE_SYSTEM,
    user: `Claim:\n"${c.claim}"\n\nSources:\n${joined.slice(0, 12000)}`,
    schema: claudeAloneSchema,
    maxTokens: 200,
  });
  return out.label;
}

// --- Runner -------------------------------------------------------------------

interface SystemDef {
  name: string;
  predict: (c: MultiSourceCase) => Promise<GoldLabel>;
}

function pct(x: number): string {
  return (x * 100).toFixed(1);
}

async function main(): Promise<void> {
  const cases = loadCases();
  process.stdout.write(`Loaded ${cases.length} multi-source case(s).\n\n`);

  const systems: SystemDef[] = [
    { name: "Mixture of Agents", predict: runMoA },
    { name: "Claude-alone", predict: runClaudeAlone },
  ];

  const gold: GoldLabel[] = cases.map((c) => c.goldLabel);
  const predictions = new Map<string, GoldLabel[]>();
  const errors = new Map<string, number>();

  for (const s of systems) {
    const preds: GoldLabel[] = [];
    let errCount = 0;
    for (let i = 0; i < cases.length; i++) {
      let label: GoldLabel = "NEI";
      try {
        label = await s.predict(cases[i]);
      } catch (err: unknown) {
        errCount += 1;
        const msg = err instanceof Error ? err.message : "unknown error";
        process.stderr.write(`  [${s.name}] case ${cases[i].id} failed, scored NEI: ${msg}\n`);
      }
      preds.push(label);
      process.stdout.write(`\r  [${s.name}] ${i + 1}/${cases.length}...${i + 1 === cases.length ? "\n" : ""}`);
    }
    predictions.set(s.name, preds);
    errors.set(s.name, errCount);
  }

  // Metrics per system.
  const summaries = systems.map((s) => {
    const pairs: LabelPair<GoldLabel>[] = gold.map((g, i) => ({ gold: g, pred: predictions.get(s.name)![i] }));
    return { name: s.name, summary: computeMetrics(pairs), errors: errors.get(s.name) ?? 0 };
  });

  // Headline + per-case + per-system tables.
  const lines: string[] = [];
  lines.push("# PaperTrail Multi-Source (Contested-Evidence) Benchmark");
  lines.push("");
  lines.push(
    "_The fair test of the **Mixture of Agents**: each claim is judged against SEVERAL real " +
      "trials (agreeing or conflicting), so the composing agents (MultiVerS aggregation, PyMARE " +
      "pooling, STORM debate) actually fire — unlike the single-source set. Claude-alone sees the " +
      "same concatenated sources, isolating whether the composition reasons over the totality better._"
  );
  lines.push("");
  lines.push(`- Cases: **${cases.length}**`);
  lines.push("- Run: `MOA fixture` via `npx tsx scripts/benchmark/multisource.ts`");
  lines.push("");
  lines.push("## Headline comparison");
  lines.push("");
  lines.push("| System | Accuracy | Macro-F1 | Micro-F1 | Errored (NEI) | N |");
  lines.push("| --- | ---: | ---: | ---: | ---: | ---: |");
  for (const r of summaries) {
    const { accuracy, macroF1, microF1, matrix } = r.summary;
    lines.push(`| ${r.name} | ${pct(accuracy)}% | ${pct(macroF1)}% | ${pct(microF1)}% | ${r.errors} | ${matrix.total} |`);
  }
  lines.push("");
  lines.push("## Per-case predictions");
  lines.push("");
  lines.push("| Case | Gold | " + systems.map((s) => s.name).join(" | ") + " |");
  lines.push("| --- | --- | " + systems.map(() => "---").join(" | ") + " |");
  for (let i = 0; i < cases.length; i++) {
    const row = systems.map((s) => {
      const p = predictions.get(s.name)![i];
      return p === gold[i] ? p : `**${p}**`;
    });
    lines.push(`| ${cases[i].id} | ${gold[i]} | ${row.join(" | ")} |`);
  }
  lines.push("");
  lines.push("_Bold = disagreed with gold._");
  lines.push("");
  for (const r of summaries) {
    lines.push(formatMetricsTable(r.summary, { title: r.name }));
    lines.push("");
  }

  const doc = lines.join("\n") + "\n";
  await fs.writeFile(DOCS_PATH, doc, "utf8");

  process.stdout.write("\n");
  for (const r of summaries) {
    process.stdout.write(`${r.name}: accuracy ${pct(r.summary.accuracy)}%  macro-F1 ${pct(r.summary.macroF1)}%\n`);
  }
  process.stdout.write(`\nWrote results to ${DOCS_PATH}\n`);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : "unknown error";
  process.stderr.write(`\nMulti-source benchmark failed: ${msg}\n`);
  process.exit(1);
});
