// PaperTrail MoA — the grounded SYNTHESIZER. After the deterministic aggregator has
// FIXED the verdict + trust score, Claude writes the human-readable narrative that
// EXPLAINS the already-decided result. It may cite only the grounded spans the experts
// produced (verbatim source substrings) and the fixed verdict/trust — it never changes a
// number, never overturns the verdict, and never introduces a claim about a source that
// isn't in the provided grounded spans. If synthesis is disabled or fails, a deterministic
// fallback narrative is assembled from the experts' own one-line summaries.

import { z } from "zod";
import type { AgentContribution, GroundedSpan } from "./types";
import type { MoaAggregate } from "./aggregate";

const SynthesisSchema = z.object({
  narrative: z.string().trim().max(1600),
});

export interface SynthesisInput {
  claim: string;
  aggregate: MoaAggregate;
  contributions: readonly AgentContribution[];
  llm: boolean;
}

export interface SynthesisResult {
  narrative: string;
  usedClaude: boolean;
  // Grounded spans handed to the synthesizer, echoed for the citation trail in the UI.
  citations: GroundedSpan[];
}

export type SynthesizerClaudeCaller = <T>(args: {
  system: string;
  user: string;
  schema: { parse: (v: unknown) => T };
  maxTokens?: number;
}) => Promise<T>;

const SYNTH_SYSTEM =
  "You are the synthesis writer for PaperTrail's Mixture-of-Agents evidence verifier. The " +
  "VERDICT and TRUST SCORE have ALREADY been computed deterministically and are FINAL — you " +
  "must not change, contradict, or re-derive them. Write a concise, neutral narrative (3-6 " +
  "sentences) that explains the verdict to a translational-research audience, referring only to " +
  "the expert findings and the grounded quotes provided. Do NOT invent evidence, do NOT cite a " +
  "quote that was not given to you, do NOT state a different verdict or number. If the verdict is " +
  "mixed or insufficient, say so plainly. Return ONLY JSON: {\"narrative\":string}.";

function collectCitations(contributions: readonly AgentContribution[]): GroundedSpan[] {
  const seen = new Set<string>();
  const out: GroundedSpan[] = [];
  for (const c of contributions) {
    for (const s of c.groundedSpans) {
      const key = s.sourceId + "|" + s.start + "|" + s.end + "|" + s.text;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(s);
    }
  }
  return out;
}

function buildSynthUser(input: SynthesisInput, citations: readonly GroundedSpan[]): string {
  return JSON.stringify({
    claim: input.claim,
    finalVerdict: input.aggregate.verdict,
    finalTrust: input.aggregate.trust,
    agreement: input.aggregate.agreement,
    expertFindings: input.contributions
      .filter((c) => c.ran && c.summary)
      .map((c) => ({ agent: c.agentId, signal: c.signal, finding: c.summary })),
    groundedQuotes: citations.map((s) => ({ sourceId: s.sourceId, quote: s.text })),
  });
}

// Deterministic narrative used when synthesis is disabled or Claude fails. Assembles the
// verdict and the experts' own summaries — no model, always available.
function fallbackNarrative(input: SynthesisInput): string {
  const { verdict, trust } = input.aggregate;
  const voters = input.contributions.filter((c) => c.ran && c.summary);
  const head =
    verdict === "insufficient"
      ? "The available experts did not find enough grounded evidence to reach a verdict"
      : "The mixture-of-experts reached a " + verdict + " verdict";
  const findings = voters.slice(0, 6).map((c) => "- " + c.agentId + ": " + c.summary);
  return (
    head +
    " (trust " +
    trust +
    "/100).\n" +
    (findings.length ? "Expert findings:\n" + findings.join("\n") : "No expert produced a summary.")
  );
}

const lazyClaude: SynthesizerClaudeCaller = async (args) => {
  const { callClaudeForJson } = await import("../claude");
  return callClaudeForJson(args);
};

/**
 * Write the unified narrative. Never throws and never alters the verdict/trust. Returns the
 * deterministic fallback when llm is off or the model call fails, so the UI always has prose.
 */
export async function synthesize(
  input: SynthesisInput,
  caller: SynthesizerClaudeCaller = lazyClaude
): Promise<SynthesisResult> {
  const citations = collectCitations(input.contributions);

  if (!input.llm) {
    return { narrative: fallbackNarrative(input), usedClaude: false, citations };
  }

  try {
    const raw = await caller({
      system: SYNTH_SYSTEM,
      user: buildSynthUser(input, citations),
      schema: SynthesisSchema,
      maxTokens: 700,
    });
    const narrative = raw.narrative.trim();
    if (!narrative) {
      return { narrative: fallbackNarrative(input), usedClaude: true, citations };
    }
    return { narrative, usedClaude: true, citations };
  } catch {
    return { narrative: fallbackNarrative(input), usedClaude: false, citations };
  }
}
