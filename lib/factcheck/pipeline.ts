import { callClaudeForJson } from "../claude";
import { retrieveSources } from "../agents/retrievalAgent";
import { locateSpan } from "../grounding";
import type { SourceCandidate } from "../schemas";
import {
  CheckworthyResultSchema,
  DecomposeResultSchema,
  QueryGenResultSchema,
  VerifyEvidenceResultSchema,
  type ClaimResult,
  type FactCheckOutput,
  type FactCheckSummary,
  type GroundedEvidence,
  type PerClaimVerdict,
} from "./schemas";

// Native TypeScript port of the Loki / OpenFactVerification multi-step fact
// verification pipeline (factcheck/__init__.py check_text + core/*):
//
//   1. Decompose      — Claude splits text into atomic, self-contained claims.
//   2. Checkworthy    — Claude marks each claim verifiable-vs-opinion (+ reason).
//   3. Query gen      — Claude writes retrieval queries per checkworthy claim.
//   4. Retrieve       — evidence pulled from OUR cached sources (retrievalAgent),
//                       NOT the web (Loki used Serper/Google — replaced by our
//                       pgvector retrieval over the sources table).
//   5. Verify         — Claude judges each evidence supported|refuted|unverified,
//                       grounded to a real substring of the source (lib/grounding).
//   6. Aggregate      — per-claim factuality + overall summary (Loki's formula:
//                       supported / (supported + refuted)).
//
// The deterministic parts (grounding, aggregation, verdict selection, query
// dedupe) are pure native TS. Only the steps Loki did with an LLM use Claude,
// each validated against a Zod schema — never a raw JSON.parse.

const MAX_QUERIES_PER_CLAIM = 4; // Loki's max_query_per_claim (minus the claim itself).
const MAX_SOURCES_PER_CLAIM = 3; // cap evidence fan-out per claim.

// -----------------------------------------------------------------------------
// Step 1: decompose text into atomic claims.
// -----------------------------------------------------------------------------

const DECOMPOSE_SYSTEM =
  "You decompose text into atomic, context-independent factual claims. " +
  "Each claim is concise (<15 words), self-contained, and avoids vague references " +
  "like 'it'/'this'/'the drug' by using complete names. Generate at least one claim " +
  "per sentence. Respond ONLY with JSON: {\"claims\": [\"...\"]}.";

export async function decomposeClaims(text: string): Promise<string[]> {
  const result = await callClaudeForJson({
    system: DECOMPOSE_SYSTEM,
    user: `Text:\n${text}\n\nOutput the JSON now.`,
    schema: DecomposeResultSchema,
    maxTokens: 1024,
  });
  // Dedupe while preserving order — repeated sentences shouldn't fan out twice.
  return dedupe(result.claims.map((c) => c.trim()).filter((c) => c.length > 0));
}

// -----------------------------------------------------------------------------
// Step 2: checkworthiness — which claims are objectively verifiable.
// -----------------------------------------------------------------------------

const CHECKWORTHY_SYSTEM =
  "For each statement, decide if its factuality can be objectively verified " +
  "(a factual claim), versus an opinion or a claim too vague to check (e.g. an " +
  "unresolved 'he'). Respond ONLY with JSON: " +
  '{"items": [{"claim": "<verbatim>", "checkworthy": true|false, "reason": "<brief>"}]}. ' +
  "Include one item for every input claim, in order.";

export async function assessCheckworthiness(
  claims: readonly string[]
): Promise<Map<string, { checkworthy: boolean; reason: string }>> {
  const numbered = claims.map((c, i) => `${i + 1}. ${c}`).join("\n");
  const result = await callClaudeForJson({
    system: CHECKWORTHY_SYSTEM,
    user: `Statements:\n${numbered}\n\nOutput the JSON now.`,
    schema: CheckworthyResultSchema,
    maxTokens: 1024,
  });

  // Map back by claim text. Loki's fallback: if the model fails to classify a
  // claim, assume it IS checkworthy (better to verify than silently skip).
  const byClaim = new Map<string, { checkworthy: boolean; reason: string }>();
  for (const item of result.items) {
    byClaim.set(item.claim.trim(), { checkworthy: item.checkworthy, reason: item.reason });
  }
  const resolved = new Map<string, { checkworthy: boolean; reason: string }>();
  for (const claim of claims) {
    const hit = byClaim.get(claim) ?? findLoose(byClaim, claim);
    resolved.set(
      claim,
      hit ?? { checkworthy: true, reason: "Defaulted to checkworthy (not classified by model)." }
    );
  }
  return resolved;
}

// -----------------------------------------------------------------------------
// Step 3: query generation for a checkworthy claim.
// -----------------------------------------------------------------------------

const QGEN_SYSTEM =
  "Given a claim, write the minimum set of retrieval questions needed to verify it. " +
  'Respond ONLY with JSON: {"queries": ["..."]} (at most 4 questions).';

export async function generateQueries(claim: string): Promise<string[]> {
  let generated: string[] = [];
  try {
    const result = await callClaudeForJson({
      system: QGEN_SYSTEM,
      user: `Claim: ${claim}\n\nOutput the JSON now.`,
      schema: QueryGenResultSchema,
      maxTokens: 512,
    });
    generated = result.queries.map((q) => q.trim()).filter((q) => q.length > 0);
  } catch {
    // Query gen is a retrieval aid, not a trust boundary — on failure fall back
    // to the claim itself (Loki always prepends the claim as query #1 anyway).
    generated = [];
  }
  // Loki: each claim's query list starts with the claim itself, then generated.
  return dedupe([claim, ...generated]).slice(0, MAX_QUERIES_PER_CLAIM + 1);
}

// -----------------------------------------------------------------------------
// Step 4: retrieve evidence from OUR cached sources (replaces Serper/Google).
// -----------------------------------------------------------------------------

async function retrieveEvidence(queries: readonly string[]): Promise<SourceCandidate[]> {
  const seen = new Set<string>();
  const evidence: SourceCandidate[] = [];
  for (const query of queries) {
    if (evidence.length >= MAX_SOURCES_PER_CLAIM) break;
    let sources: SourceCandidate[] = [];
    try {
      sources = await retrieveSources(query);
    } catch {
      // A retrieval failure for one query shouldn't sink the claim — the claim
      // simply ends up with less (or no) evidence and becomes "unverified".
      sources = [];
    }
    for (const src of sources) {
      if (evidence.length >= MAX_SOURCES_PER_CLAIM) break;
      if (seen.has(src.id)) continue;
      seen.add(src.id);
      evidence.push(src);
    }
  }
  return evidence;
}

// -----------------------------------------------------------------------------
// Step 5: verify a claim against one retrieved source, grounded to a span.
// -----------------------------------------------------------------------------

const VERIFY_SYSTEM =
  "Judge whether the SOURCE supports, refutes, or does not address the CLAIM. " +
  "Quote the exact substring of the SOURCE that justifies your judgement in " +
  '"source_span" (copy verbatim; leave empty only for "unverified"). Respond ' +
  'ONLY with JSON: {"relationship": "supported"|"refuted"|"unverified", ' +
  '"reasoning": "<brief>", "source_span": "<verbatim quote from SOURCE>"}.';

async function verifyAgainstSource(
  claim: string,
  source: SourceCandidate
): Promise<{ evidence: GroundedEvidence; dropped: boolean }> {
  let judged;
  try {
    judged = await callClaudeForJson({
      system: VERIFY_SYSTEM,
      user: `CLAIM: ${claim}\n\nSOURCE:\n${source.raw_text}\n\nOutput the JSON now.`,
      schema: VerifyEvidenceResultSchema,
      maxTokens: 512,
    });
  } catch {
    // Model failed / invalid JSON: treat as unverified rather than fabricate.
    judged = { relationship: "unverified" as const, reasoning: "Could not verify against this source.", source_span: "" };
  }

  // Grounding invariant: a supported/refuted verdict MUST point at a real
  // substring of the source. If the quoted span can't be located, we drop the
  // span and downgrade the verdict to "unverified" — PaperTrail never makes an
  // unsourced claim about a source.
  const located = judged.source_span.trim().length > 0 ? locateSpan(source.raw_text, judged.source_span) : null;
  const grounded = located !== null;
  const dropped = judged.source_span.trim().length > 0 && !grounded;

  const relationship =
    judged.relationship !== "unverified" && !grounded ? "unverified" : judged.relationship;

  const evidence: GroundedEvidence = {
    source_id: source.id,
    source_type: source.source_type,
    external_id: source.external_id,
    title: source.title,
    url: source.url,
    relationship,
    reasoning: judged.reasoning,
    source_span: located ? located.text : null,
    span_start: located ? located.start : null,
    span_end: located ? located.end : null,
  };
  return { evidence, dropped };
}

// -----------------------------------------------------------------------------
// Step 6: aggregate per-claim + overall (Loki's factuality formula).
// -----------------------------------------------------------------------------

function aggregateClaim(evidence: readonly GroundedEvidence[]): {
  verdict: PerClaimVerdict;
  factuality: number | null;
} {
  const supported = evidence.filter((e) => e.relationship === "supported").length;
  const refuted = evidence.filter((e) => e.relationship === "refuted").length;

  // No supporting/refuting evidence located: honestly "unverified".
  if (supported + refuted === 0) {
    return { verdict: "unverified", factuality: null };
  }
  const factuality = supported / (supported + refuted);
  // Verdict is the dominant grounded relationship; ties (mixed evidence) are
  // "unverified" (controversial) rather than a false-confident pick.
  const verdict: PerClaimVerdict =
    supported > refuted ? "supported" : refuted > supported ? "refuted" : "unverified";
  return { verdict, factuality };
}

// -----------------------------------------------------------------------------
// Orchestrator: the full check_text chain.
// -----------------------------------------------------------------------------

export async function runFactCheck(text: string): Promise<FactCheckOutput> {
  // Step 1.
  const claims = await decomposeClaims(text);

  // Step 2 (all claims classified in one call, like Loki's batched checkworthy).
  const checkworthy = await assessCheckworthiness(claims);

  // Steps 3-6, per claim. Sequential to respect the API budget (each claim can
  // fire several verify calls); correctness, not throughput, is the priority.
  const claimResults: ClaimResult[] = [];
  for (const claim of claims) {
    const cw = checkworthy.get(claim) ?? {
      checkworthy: true,
      reason: "Defaulted to checkworthy.",
    };

    if (!cw.checkworthy) {
      claimResults.push({
        claim,
        checkworthy: false,
        checkworthy_reason: cw.reason,
        queries: [],
        verdict: "not_checkworthy",
        factuality: null,
        evidence: [],
        grounding_dropped_count: 0,
      });
      continue;
    }

    const queries = await generateQueries(claim);
    const sources = await retrieveEvidence(queries);

    const evidence: GroundedEvidence[] = [];
    let droppedCount = 0;
    for (const source of sources) {
      const { evidence: ev, dropped } = await verifyAgainstSource(claim, source);
      if (dropped) droppedCount += 1;
      evidence.push(ev);
    }

    const { verdict, factuality } = aggregateClaim(evidence);
    claimResults.push({
      claim,
      checkworthy: true,
      checkworthy_reason: cw.reason,
      queries,
      verdict,
      factuality,
      evidence,
      grounding_dropped_count: droppedCount,
    });
  }

  return { claims: claimResults, summary: summarize(claimResults) };
}

function summarize(claims: readonly ClaimResult[]): FactCheckSummary {
  const checkworthy = claims.filter((c) => c.checkworthy);
  const verified = claims.filter((c) => c.factuality !== null);
  const supported = verified.filter((c) => c.factuality === 1).length;
  const refuted = verified.filter((c) => c.factuality === 0).length;
  const controversial = verified.length - supported - refuted;
  const factuality =
    verified.length === 0
      ? null
      : verified.reduce((sum, c) => sum + (c.factuality ?? 0), 0) / verified.length;

  return {
    num_claims: claims.length,
    num_checkworthy: checkworthy.length,
    num_verified: verified.length,
    num_supported: supported,
    num_refuted: refuted,
    num_controversial: controversial,
    factuality,
  };
}

// --- pure helpers ------------------------------------------------------------

function dedupe(items: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

// Loose match for checkworthiness mapping when the model lightly reworded the
// claim in its key (trim/whitespace/trailing period differences).
function findLoose<T>(map: Map<string, T>, claim: string): T | undefined {
  const norm = (s: string) => s.trim().replace(/\s+/g, " ").replace(/\.$/, "").toLowerCase();
  const target = norm(claim);
  for (const [key, value] of map) {
    if (norm(key) === target) return value;
  }
  return undefined;
}
