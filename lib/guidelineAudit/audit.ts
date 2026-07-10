// GUIDELINE / PRESS-RELEASE AUDIT — the "point PaperTrail at published science"
// capability.
//
// Paste a clinical guideline or a press release; PaperTrail extracts EVERY efficacy
// claim the document makes and verifies each one against primary sources, flagging
// overstatements. Two stages, and the division of labour is deliberate:
//
//   STAGE 1 — HEAVY CLAUDE (extraction). Claude reads the WHOLE document and pulls out
//     each discrete efficacy claim as a standalone, verifiable statement, quoting the
//     exact sentence it came from. This is genuinely hard work regex can't do: a press
//     release buries claims in marketing prose, resolves pronouns across sentences, and
//     mixes efficacy claims with safety/logistics noise. Claude's JSON is validated
//     against a Zod schema (callClaudeForJson) and every claim is grounded to an EXACT
//     span of the pasted text via lib/grounding.ts. A claim whose sentence can't be
//     located verbatim is DROPPED — an ungrounded claim is an unsourced claim.
//
//   STAGE 2 — DETERMINISTIC VERIFY (trust layer). For each extracted claim we run the
//     existing verification path (runEvidencePipeline): retrieve cached primary sources,
//     pool their registered effects, and rate the body of evidence with GRADE. NO LLM
//     touches the numbers. The claim's verdict + trust score are derived entirely from
//     that deterministic report — Claude proposes claims, the engine adjudicates them.
//
// verify/pipeline is INJECTABLE so tests exercise the full flow offline (mock verify +
// mock Claude), with no live embeddings, DB, or model calls.

import type { Pool } from "pg";
import { getClaude, CLAUDE_MODEL } from "../claude";
import { locateSpan } from "../grounding";
import { runEvidencePipeline } from "../evidencePipeline";
import type { EvidencePipelineResult } from "../evidencePipeline";
import {
  ClaimExtractionSchema,
  type AuditedClaim,
  type AuditedPooledFinding,
  type AuditVerdict,
  type ExtractedClaim,
  type GuidelineAuditResult,
} from "./schemas";

// ---------------------------------------------------------------------------
// Stage 1 — Claude claim extraction (heavy Claude, Zod-validated).
// ---------------------------------------------------------------------------

const EXTRACTION_SYSTEM = [
  "You are an evidence auditor. You are given the full text of a clinical guideline,",
  "press release, or review that makes claims about how well a drug or intervention works.",
  "",
  "Extract EVERY discrete EFFICACY claim the document makes — claims that an intervention",
  "produces a beneficial clinical effect (reduces events, improves survival, lowers risk,",
  "increases response rate, etc.). Rewrite each as a single, standalone, verifiable",
  "statement: resolve pronouns and cross-references so the claim stands on its own, and",
  "preserve any stated magnitude (e.g. '30% relative risk reduction').",
  "",
  "For each claim also return `sourceSentence`: the EXACT, VERBATIM sentence from the",
  "document that makes the claim — copied character-for-character, so it can be located",
  "in the original text. Do not paraphrase the sourceSentence.",
  "",
  "Rules:",
  "- Only efficacy claims. Ignore safety/adverse-event statements, dosing logistics,",
  "  regulatory/approval statements, background disease facts, and boilerplate.",
  "- One claim per statement. If a sentence makes two efficacy claims, emit two entries",
  "  that share the same sourceSentence.",
  "- If the document makes NO efficacy claims, return an empty claims array.",
  "- Do not invent claims the document does not make.",
  "",
  'Return ONLY JSON: {"claims":[{"statement":"...","sourceSentence":"...","intervention":"..."}]}',
].join("\n");

// callClaudeForJson caps at 1024 tokens by default; a full guideline can yield many
// claims, so we call the client directly with a larger budget and reuse the same
// clean-then-validate discipline.
async function extractClaims(documentText: string): Promise<ExtractedClaim[]> {
  const anthropic = getClaude();
  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 4096,
    system: EXTRACTION_SYSTEM,
    messages: [
      {
        role: "user",
        content: `Extract every efficacy claim from this document:\n\n${documentText}`,
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Claude returned no text block for claim extraction");
  }

  const cleaned = textBlock.text
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "");

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(
      `Claude did not return valid JSON for claim extraction: ${cleaned.slice(0, 200)}`
    );
  }

  // Never trust raw JSON.parse of an LLM response — validate against the Zod schema.
  return ClaimExtractionSchema.parse(parsed).claims;
}

// ---------------------------------------------------------------------------
// Stage 2 — deterministic verification, and mapping the evidence report to a
// per-claim verdict + trust score. NO LLM below this line.
// ---------------------------------------------------------------------------

// A verifier turns one claim statement into an evidence report. Default is the real
// end-to-end pipeline over cached sources; tests inject a stub.
export type ClaimVerifier = (claim: string) => Promise<EvidencePipelineResult>;

// GRADE certainty → a defensible base trust score for a supported claim. The claim/pool
// verdict then adjusts from there. This is a fixed mapping, not a model output.
const CERTAINTY_TRUST: Record<string, number> = {
  high: 90,
  moderate: 75,
  low: 55,
  very_low: 40,
};

// Map the deterministic evidence report onto the audit verdict + trust score for one
// claim. Pure: derives everything from the report, mutates nothing.
function verdictFromReport(report: EvidencePipelineResult["report"]): {
  verdict: AuditVerdict;
  trustScore: number;
  explanation: string;
  pooledFinding: AuditedPooledFinding | null;
} {
  // No poolable body of evidence: retrieval/synthesis couldn't confidently ground the
  // claim in primary sources. Honest "unsupported" rather than a forced low verdict.
  if (!report.ok) {
    return {
      verdict: "unsupported",
      trustScore: 0,
      explanation:
        report.reason ??
        "No confident primary source could be found to verify this claim.",
      pooledFinding: null,
    };
  }

  const pooled = report.pooled;
  const finding: AuditedPooledFinding = {
    measure: pooled.measure,
    point: pooled.random.point,
    ciLower: pooled.random.ciLower,
    ciUpper: pooled.random.ciUpper,
    studies: pooled.k,
    summary: `Pooled ${pooled.measure} ${pooled.random.point} (95% CI ${pooled.random.ciLower}–${pooled.random.ciUpper}) across ${pooled.k} primary ${pooled.k === 1 ? "source" : "sources"}.`,
  };

  const base = CERTAINTY_TRUST[report.certainty.certainty] ?? 50;
  const v = report.verdict.verdict;

  // Verdicts that mean the document OVERSTATES what the primary evidence shows.
  if (
    v === "overstates_pooled" ||
    v === "single_trial_cherry_pick" ||
    v === "significance_mismatch"
  ) {
    return {
      verdict: "overstated",
      // Overstatement caps trust low regardless of GRADE certainty — the claim as
      // written is not what the evidence supports.
      trustScore: Math.min(base, 35),
      explanation: report.verdict.rationale,
      pooledFinding: finding,
    };
  }

  // Verdicts where we found evidence but it's too weak/inconsistent to adjudicate.
  if (
    v === "high_heterogeneity" ||
    v === "insufficient_evidence" ||
    v === "not_comparable"
  ) {
    return {
      verdict: "uncertain",
      trustScore: Math.min(base, 50),
      explanation: report.verdict.rationale,
      pooledFinding: finding,
    };
  }

  // matches_pooled / understates_pooled → the claim is supported by (or is more
  // conservative than) the primary evidence.
  return {
    verdict: "accurate",
    trustScore: base,
    explanation: report.verdict.rationale,
    pooledFinding: finding,
  };
}

// Ground one extracted claim's source sentence to an exact span of the pasted document,
// then verify it. Returns null when the sentence can't be located — an ungrounded claim
// is an unsourced claim, so it is dropped rather than reported.
async function auditOneClaim(
  extracted: ExtractedClaim,
  documentText: string,
  verify: ClaimVerifier
): Promise<AuditedClaim | null> {
  const located = locateSpan(documentText, extracted.sourceSentence);
  if (!located) {
    return null;
  }

  const { report } = await verify(extracted.statement);
  const { verdict, trustScore, explanation, pooledFinding } = verdictFromReport(report);

  return {
    text: extracted.statement,
    intervention: extracted.intervention,
    groundedSpan: {
      text: located.text,
      start: located.start,
      end: located.end,
      status: located.status,
    },
    verdict,
    trustScore,
    explanation,
    pooledFinding,
  };
}

// ---------------------------------------------------------------------------
// Public entry point.
// ---------------------------------------------------------------------------

/**
 * Audit a pasted document end to end: Claude extracts every efficacy claim (Stage 1,
 * heavy Claude + Zod), each claim is grounded to an exact sentence in the source and
 * verified against primary evidence (Stage 2, deterministic), and the results are
 * summarised. Claims whose source sentence can't be grounded are dropped.
 *
 * `verify` is injectable so the full flow can run offline in tests. `extract` is
 * injectable for the same reason (mock the Claude call). By default both use the real
 * implementations (Claude + runEvidencePipeline over cached sources).
 */
export async function auditGuideline(
  pool: Pool,
  documentText: string,
  opts?: {
    verify?: ClaimVerifier;
    extract?: (text: string) => Promise<ExtractedClaim[]>;
  }
): Promise<GuidelineAuditResult> {
  const extract = opts?.extract ?? extractClaims;
  const verify: ClaimVerifier =
    opts?.verify ?? ((claim) => runEvidencePipeline(pool, { claim }));

  const extracted = await extract(documentText);

  // Verify each claim. Failures on a single claim (e.g. a transient retrieval error)
  // must not sink the whole audit — surface that claim as "unsupported" with a note
  // rather than 500-ing a document that has other perfectly good claims.
  const audited = await Promise.all(
    extracted.map(async (claim): Promise<AuditedClaim | null> => {
      try {
        return await auditOneClaim(claim, documentText, verify);
      } catch {
        const located = locateSpan(documentText, claim.sourceSentence);
        if (!located) return null;
        return {
          text: claim.statement,
          intervention: claim.intervention,
          groundedSpan: {
            text: located.text,
            start: located.start,
            end: located.end,
            status: located.status,
          },
          verdict: "unsupported",
          trustScore: 0,
          explanation:
            "This claim could not be verified against primary sources due to a retrieval error.",
          pooledFinding: null,
        };
      }
    })
  );

  const claims = audited.filter((c): c is AuditedClaim => c !== null);

  const summary = {
    total: claims.length,
    overstated: claims.filter((c) => c.verdict === "overstated").length,
    unsupported: claims.filter((c) => c.verdict === "unsupported").length,
    accurate: claims.filter((c) => c.verdict === "accurate").length,
  };

  return { claims, summary };
}
