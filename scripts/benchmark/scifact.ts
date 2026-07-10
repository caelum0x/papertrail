import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";
import {
  benchmarkCaseSchema,
  benchmarkCaseArraySchema,
  scifactSplitSchema,
  type BenchmarkCase,
  type GoldLabel,
  type ScifactSplit,
} from "@/lib/eval/benchmarkTypes";

// SciFact -> PaperTrail benchmark loader.
//
// Reads the real (gitignored) SciFact release under reference/scifact/data and
// maps each claim to a BenchmarkCase: the cited corpus doc(s) become the SOURCE
// (raw_text = title + "\n" + abstract.join(" ")), and the gold label is derived
// from the SciFact evidence labels (empty evidence => NEI).
//
// loadSample() reads the committed fixture instead, so the benchmark can run
// without the gitignored data (e.g. in CI or on a fresh clone).

// Default location of the extracted SciFact data. The published tarball extracts
// to an inner `data/` directory, so the real jsonl files live at
// reference/scifact/data/data/*.jsonl relative to the repo root.
const DEFAULT_DATA_DIR = resolve(process.cwd(), "reference/scifact/data/data");

// Committed, self-contained curated subset. Lives under tests/fixtures so the
// benchmark runs on a fresh clone with no gitignored data present.
const SAMPLE_FIXTURE_PATH = resolve(
  process.cwd(),
  "tests/fixtures/scifact-sample.json"
);

// ---------------------------------------------------------------------------
// Raw SciFact schemas (boundary validation for the gitignored JSONL files).
// ---------------------------------------------------------------------------

const scifactEvidenceItemSchema = z.object({
  sentences: z.array(z.number().int()),
  label: z.enum(["SUPPORT", "CONTRADICT"]),
});

const scifactClaimSchema = z.object({
  id: z.number().int(),
  claim: z.string(),
  // Map of corpus doc_id (as a string key) -> evidence items. Empty object = NEI.
  evidence: z.record(z.string(), z.array(scifactEvidenceItemSchema)),
  cited_doc_ids: z.array(z.number().int()),
});

type ScifactClaim = z.infer<typeof scifactClaimSchema>;

const scifactCorpusDocSchema = z.object({
  doc_id: z.number().int(),
  title: z.string(),
  abstract: z.array(z.string()),
});

type ScifactCorpusDoc = z.infer<typeof scifactCorpusDocSchema>;

export interface LoadScifactOptions {
  split: ScifactSplit;
  // Cap the number of returned cases (applied after gold-label derivation, in
  // file order). Omit to load the whole split.
  limit?: number;
  // Override the directory containing claims_<split>.jsonl and corpus.jsonl.
  dataDir?: string;
}

// ---------------------------------------------------------------------------
// JSONL parsing helpers.
// ---------------------------------------------------------------------------

function readJsonl(path: string): unknown[] {
  const contents = readFileSync(path, "utf8");
  const rows: unknown[] = [];
  for (const line of contents.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    rows.push(JSON.parse(trimmed) as unknown);
  }
  return rows;
}

function loadCorpus(dataDir: string): Map<number, ScifactCorpusDoc> {
  const corpusPath = join(dataDir, "corpus.jsonl");
  if (!existsSync(corpusPath)) {
    throw new Error(
      `SciFact corpus not found at ${corpusPath}. The dataset is gitignored — ` +
        `extract reference/scifact/data/data.tar.gz or pass a dataDir, or use loadSample().`
    );
  }
  const byId = new Map<number, ScifactCorpusDoc>();
  for (const raw of readJsonl(corpusPath)) {
    const doc = scifactCorpusDocSchema.parse(raw);
    byId.set(doc.doc_id, doc);
  }
  return byId;
}

// Join a corpus doc into the raw source text PaperTrail verifies against.
function docToRawText(doc: ScifactCorpusDoc): string {
  return `${doc.title}\n${doc.abstract.join(" ")}`;
}

// Derive the three-way gold label from a claim's evidence. SciFact never mixes
// SUPPORT and CONTRADICT within a single claim's evidence, so the first label
// found is authoritative; empty evidence means NEI.
function deriveGoldLabel(claim: ScifactClaim): GoldLabel {
  const labels = new Set<string>();
  for (const items of Object.values(claim.evidence)) {
    for (const item of items) labels.add(item.label);
  }
  if (labels.size === 0) return "NEI";
  if (labels.has("CONTRADICT") && !labels.has("SUPPORT")) return "CONTRADICT";
  if (labels.has("SUPPORT") && !labels.has("CONTRADICT")) return "SUPPORT";
  // Defensive: if a claim ever mixes labels, treat a present CONTRADICT as the
  // stronger signal (a flagged distortion) so we don't silently call it SUPPORT.
  return labels.has("CONTRADICT") ? "CONTRADICT" : "SUPPORT";
}

// Build the source text for a claim by joining every cited corpus doc that we
// can resolve. Returns null when none of the cited docs exist in the corpus
// (that claim is skipped rather than emitted with an empty source).
function buildSourceText(
  claim: ScifactClaim,
  corpus: Map<number, ScifactCorpusDoc>
): string | null {
  const parts: string[] = [];
  for (const docId of claim.cited_doc_ids) {
    const doc = corpus.get(docId);
    if (doc) parts.push(docToRawText(doc));
  }
  if (parts.length === 0) return null;
  return parts.join("\n\n");
}

// ---------------------------------------------------------------------------
// Public API.
// ---------------------------------------------------------------------------

/**
 * Load a SciFact split as PaperTrail BenchmarkCase[] by joining each claim to
 * its cited corpus doc(s). Reads the gitignored dataset under `dataDir`
 * (default: reference/scifact/data/data). Throws with a clear message if the
 * files are missing — use loadSample() when the data isn't available.
 */
export function loadScifact(options: LoadScifactOptions): BenchmarkCase[] {
  const split: ScifactSplit = scifactSplitSchema.parse(options.split);
  const dataDir = options.dataDir ?? DEFAULT_DATA_DIR;

  const claimsPath = join(dataDir, `claims_${split}.jsonl`);
  if (!existsSync(claimsPath)) {
    throw new Error(
      `SciFact claims not found at ${claimsPath}. The dataset is gitignored — ` +
        `extract reference/scifact/data/data.tar.gz or pass a dataDir, or use loadSample().`
    );
  }

  const corpus = loadCorpus(dataDir);
  const cases: BenchmarkCase[] = [];

  for (const raw of readJsonl(claimsPath)) {
    const claim = scifactClaimSchema.parse(raw);
    const sourceText = buildSourceText(claim, corpus);
    if (sourceText === null) continue; // no resolvable source — skip

    const benchmarkCase: BenchmarkCase = benchmarkCaseSchema.parse({
      id: String(claim.id),
      claim: claim.claim,
      sourceText,
      goldLabel: deriveGoldLabel(claim),
      citedDocIds: claim.cited_doc_ids,
    });
    cases.push(benchmarkCase);

    if (options.limit !== undefined && cases.length >= options.limit) break;
  }

  return cases;
}

/**
 * Load the committed curated subset. This runs without the gitignored SciFact
 * data and is the default source for CI / fresh clones.
 */
export function loadSample(limit?: number): BenchmarkCase[] {
  if (!existsSync(SAMPLE_FIXTURE_PATH)) {
    throw new Error(`Sample fixture not found at ${SAMPLE_FIXTURE_PATH}.`);
  }
  const raw = JSON.parse(readFileSync(SAMPLE_FIXTURE_PATH, "utf8")) as unknown;
  const cases = benchmarkCaseArraySchema.parse(raw);
  return limit !== undefined ? cases.slice(0, limit) : cases;
}

// ---------------------------------------------------------------------------
// CLI: `tsx scripts/benchmark/scifact.ts [--split dev] [--limit N] [--sample]`
// Prints a label-distribution summary and validates every emitted case. Handy
// as a smoke test and for regenerating counts.
// ---------------------------------------------------------------------------

function summarize(cases: BenchmarkCase[]): Record<GoldLabel, number> {
  const counts: Record<GoldLabel, number> = { SUPPORT: 0, CONTRADICT: 0, NEI: 0 };
  for (const c of cases) counts[c.goldLabel] += 1;
  return counts;
}

function parseCliArgs(argv: string[]): {
  split: ScifactSplit;
  limit?: number;
  sample: boolean;
} {
  let split: ScifactSplit = "dev";
  let limit: number | undefined;
  let sample = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--sample") sample = true;
    else if (arg === "--split") split = scifactSplitSchema.parse(argv[++i]);
    else if (arg === "--limit") limit = Number.parseInt(argv[++i] ?? "", 10);
  }
  return { split, limit, sample };
}

function isMainModule(): boolean {
  // True when this file is run directly (tsx/node), false when imported.
  const entry = process.argv[1] ?? "";
  return entry.endsWith("scifact.ts") || entry.endsWith("scifact.js");
}

if (isMainModule()) {
  const { split, limit, sample } = parseCliArgs(process.argv.slice(2));
  const cases = sample ? loadSample(limit) : loadScifact({ split, limit });
  const counts = summarize(cases);
  const source = sample ? "sample fixture" : `split=${split}`;
  // eslint-disable-next-line no-console
  console.log(
    `[scifact] ${source}: ${cases.length} cases ` +
      `(SUPPORT=${counts.SUPPORT} CONTRADICT=${counts.CONTRADICT} NEI=${counts.NEI})`
  );
}
