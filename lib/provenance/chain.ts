// PROVENANCE HASH-CHAIN — the tamper-evident backbone of a submission-grade
// evidence dossier. Every number a regulated buyer submits must be defensible:
// which source it came from, what it said, and proof that the record was not
// altered after the fact. This module turns an ordered list of evidence items
// into a mini hash-chained audit log (the same construction as a blockchain
// header chain, minus the consensus): each record's hash folds in the previous
// record's hash, so mutating ANY item — or reordering them — breaks every hash
// downstream and `verifyChain` returns false.
//
// Pure and deterministic. NO LLM anywhere: hashing and scoring are numeric,
// reproducible operations. Uses only node:crypto (SHA-256). Never mutates input.

import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Local types. Defined here (not imported from a sibling vertical) so this
// module has no coupling to any parallel dossier implementation — a dossier
// upstream only has to produce items of THIS minimal shape.
// ---------------------------------------------------------------------------

/**
 * One atomic, source-backed evidence item. `value` is the load-bearing datum
 * (a pooled estimate, a disproportionality score, a p-value) rendered as it will
 * be submitted; `quote` is the exact substring of the source that supports it.
 */
export interface EvidenceItem {
  readonly statement: string;
  readonly value: string;
  readonly source: string;
  readonly quote: string;
}

/**
 * One link in the provenance chain. `index` is the item's ordinal position,
 * `prevHash` the hash of the record before it (the genesis link uses the empty
 * string), and `hash` = sha256(prevHash + canonical(item)). Carrying the item
 * inline keeps the chain self-contained: a verifier needs nothing but the chain.
 */
export interface ProvenanceRecord {
  readonly index: number;
  readonly item: EvidenceItem;
  readonly prevHash: string;
  readonly hash: string;
}

export type ProvenanceChain = readonly ProvenanceRecord[];

// The genesis link folds in this constant instead of a real previous hash, so a
// single-item chain is still a well-formed hash chain.
const GENESIS_PREV_HASH = "";

// ---------------------------------------------------------------------------
// Canonicalization + hashing
// ---------------------------------------------------------------------------

// Serialize an item to a STABLE string independent of JS object key ordering, so
// two logically-identical items always hash identically. We emit an explicit,
// fixed field order with length-prefixed segments; length prefixes make the
// encoding injective (no two distinct field tuples can collide by concatenation,
// e.g. {"ab","c"} vs {"a","bc"}), which a naive join with a delimiter cannot
// guarantee if the delimiter appears in the data.
function canonicalItem(item: EvidenceItem): string {
  const fields = [item.statement, item.value, item.source, item.quote];
  return fields.map((f) => `${f.length}:${f}`).join("|");
}

// sha256 of an arbitrary string, hex-encoded. Single choke-point so the digest
// algorithm is defined in exactly one place.
function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

// The per-record hash: fold the previous hash into this item's canonical form.
// Exported-in-spirit as the chain's single hashing rule so build + verify agree.
function recordHash(prevHash: string, item: EvidenceItem): string {
  return sha256Hex(prevHash + canonicalItem(item));
}

// ---------------------------------------------------------------------------
// Build + verify
// ---------------------------------------------------------------------------

/**
 * Build an ordered, tamper-evident provenance chain from evidence items. Each
 * record's hash = sha256(prevHash + canonical(item)); the genesis record folds in
 * the empty string. Because every hash depends on its predecessor, the chain is
 * ORDER-SENSITIVE: reordering items changes hashes from the first swapped item
 * onward. Pure and deterministic — same items in the same order always yield the
 * same chain. Does not mutate its input.
 */
export function buildProvenanceChain(
  items: readonly EvidenceItem[]
): ProvenanceChain {
  const records: ProvenanceRecord[] = [];
  let prevHash = GENESIS_PREV_HASH;

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const hash = recordHash(prevHash, item);
    records.push({ index, item, prevHash, hash });
    prevHash = hash;
  }

  return records;
}

/**
 * Verify a provenance chain is internally consistent and untampered. Recomputes
 * every record's hash from its stored `item` + `prevHash` and checks that the
 * links form an unbroken chain (each `prevHash` equals the previous `hash`, the
 * genesis link starts from the empty string, and `index` is contiguous). Returns
 * false if ANY item was mutated, any hash was edited, or records were reordered.
 * Pure; does not mutate its input.
 */
export function verifyChain(chain: ProvenanceChain): boolean {
  let prevHash = GENESIS_PREV_HASH;

  for (let i = 0; i < chain.length; i += 1) {
    const record = chain[i];

    // Ordinal must be contiguous and start at 0 — guards against a record being
    // dropped or spliced in out of position.
    if (record.index !== i) {
      return false;
    }

    // The stored back-link must match what we've walked so far.
    if (record.prevHash !== prevHash) {
      return false;
    }

    // Recompute: if the item OR the stored prevHash was altered, this differs
    // from the stored hash and the chain is rejected.
    const expected = recordHash(record.prevHash, record.item);
    if (record.hash !== expected) {
      return false;
    }

    prevHash = record.hash;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Evidence quality score
// ---------------------------------------------------------------------------

// Source-tier weights (0..1). A submission is only as defensible as the tier of
// evidence behind each claim; regulators weight a randomized/registry source far
// above an unsourced assertion. Tiers are matched by case-insensitive substring
// of the item's `source`, most-authoritative first. Documented, fixed weights —
// no LLM judgement in the number.
const SOURCE_TIER_WEIGHTS: ReadonlyArray<{ pattern: RegExp; weight: number }> = [
  // Tier 1 — regulatory / structured trial registries and label sources.
  { pattern: /clinicaltrials|clinical trials|\bfda\b|\bema\b|drugs@fda|dailymed/i, weight: 1.0 },
  // Tier 2 — indexed primary literature / curated biomedical knowledge bases.
  { pattern: /pubmed|pmc\b|pmid|open targets|opentargets|chembl|pharmgkb|clinvar|\bdoi\b/i, weight: 0.85 },
  // Tier 3 — named preprints / other identifiable scholarly sources.
  { pattern: /preprint|biorxiv|medrxiv|arxiv|\bhttp/i, weight: 0.6 },
];

// Any named-but-untiered source still counts as sourced, just weakly.
const UNTIERED_SOURCE_WEIGHT = 0.4;

// Weight for the highest tier — the denominator for normalizing the mean tier
// weight into 0..1 (a chain of all Tier-1 sources scores 1.0 on the tier axis).
const MAX_TIER_WEIGHT = 1.0;

// The quality score blends two documented axes with fixed weights.
const COVERAGE_AXIS_WEIGHT = 0.5; // fraction of items that are fully source-backed
const TIER_AXIS_WEIGHT = 0.5; //     average authority of those sources

// Classify one item's source into its tier weight; 0 if the item is not
// source-backed at all (blank source OR blank supporting quote — an unquoted
// claim is not defensible provenance under the house rule).
function itemSourceWeight(item: EvidenceItem): number {
  const source = item.source.trim();
  const quote = item.quote.trim();
  if (source === "" || quote === "") {
    return 0;
  }
  for (const tier of SOURCE_TIER_WEIGHTS) {
    if (tier.pattern.test(source)) {
      return tier.weight;
    }
  }
  return UNTIERED_SOURCE_WEIGHT;
}

/**
 * Deterministic evidence-quality score in [0, 1] for a set of evidence items.
 *
 * Two documented axes, each contributing half the score:
 *   - COVERAGE  = (# items with a non-empty source AND supporting quote) / (# items).
 *                 Measures how much of the dossier is actually source-backed.
 *   - TIER      = mean source-tier weight over the source-backed items, normalized
 *                 by the top tier weight. Measures how authoritative those sources
 *                 are (registry/regulatory > indexed literature > preprint > other).
 *
 * score = 0.5 * coverage + 0.5 * tier.
 *
 * An empty set scores 0 (nothing to defend). Fixed, published weights — there is
 * no language model in this number. Pure; does not mutate its input.
 */
export function evidenceQualityScore(items: readonly EvidenceItem[]): number {
  if (items.length === 0) {
    return 0;
  }

  const weights = items.map(itemSourceWeight);
  const backed = weights.filter((w) => w > 0);

  const coverage = backed.length / items.length;

  const tier =
    backed.length === 0
      ? 0
      : backed.reduce((sum, w) => sum + w, 0) / backed.length / MAX_TIER_WEIGHT;

  const score = COVERAGE_AXIS_WEIGHT * coverage + TIER_AXIS_WEIGHT * tier;

  // Clamp defensively against float drift; round to 4dp for a stable, comparable
  // number across runs.
  const clamped = Math.min(1, Math.max(0, score));
  return Math.round(clamped * 10_000) / 10_000;
}
