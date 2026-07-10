import { describe, it, expect } from "vitest";
import { generateHypotheses, deriveSignals, type HypothesesLlm } from "../lib/hypotheses/generate";
import type { SourceRetriever } from "../lib/evidencePipeline";
import type { SourceCandidate } from "../lib/schemas";
import type { HypothesesLlmOutput } from "../lib/hypotheses/schemas";

// Grounded research-gap + hypotheses engine test. Retrieval AND the Claude call are
// injected, so the whole chain runs with no embeddings, no DB, and no Anthropic API:
// fixture sources → deterministic pool → derived signals → (fake) Claude → grounding gate.

const fakePool = {} as never;

// Two CT.gov sources with deliberately DIVERGENT hazard ratios so the pool has real
// between-study heterogeneity — guaranteeing a derivable signal to ground a gap on.
function ctSource(id: string, hr: number, lo: number, hi: number): SourceCandidate {
  return {
    id,
    source_type: "clinicaltrials",
    external_id: `NCT${id}`,
    title: `Trial ${id}`,
    raw_text: "Registered trial with posted primary results.",
    url: `https://clinicaltrials.gov/study/NCT${id}`,
    similarity: 0.9,
    phase: "PHASE3",
    enrollment_count: 1000,
    registered_results: [
      {
        outcomeTitle: "Primary composite endpoint",
        outcomeType: "PRIMARY",
        paramType: "Hazard Ratio (HR)",
        paramValue: hr,
        ciPct: 95,
        ciLower: lo,
        ciUpper: hi,
        pValue: "0.02",
        method: "Cox",
      },
    ],
  };
}

describe("deriveSignals", () => {
  it("emits an honest no_support_found signal for an insufficient report", () => {
    const signals = deriveSignals({
      ok: false,
      claim: "x",
      reason: "nothing to pool",
      claimedReductionPercent: null,
      usableStudies: 0,
      skipped: [],
    });
    expect(signals).toHaveLength(1);
    expect(signals[0].kind).toBe("no_support_found");
    expect(signals[0].id).toBe("sig-no-support");
  });
});

describe("generateHypotheses", () => {
  it("grounds a topic, derives signals, and keeps only signal-anchored Claude output", async () => {
    const retrieve: SourceRetriever = async () => [
      ctSource("1", 0.55, 0.4, 0.75),
      ctSource("2", 0.95, 0.7, 1.3),
    ];

    // A fake Claude that returns one GROUNDED gap+hypothesis (cites a real signal id) and
    // one UNGROUNDED gap+hypothesis (invents "sig-made-up"). The engine must drop the
    // invented ones and count them.
    const llm: HypothesesLlm = async ({ user }) => {
      // Pick a real signal id out of the prompt to prove the derivation ran.
      const match = user.match(/id=(sig-[a-z-]+)/);
      const realId = match?.[1] ?? "sig-heterogeneity";
      const out: HypothesesLlmOutput = {
        gaps: [
          {
            signal_id: realId,
            title: "Effect not consistent across populations",
            why_gap: "The pooled HR varies enough that a moderator is likely at play.",
            affected_population: "older adults",
          },
          {
            signal_id: "sig-made-up",
            title: "Invented gap that cites no engine signal",
            why_gap: "This should be dropped by the grounding gate.",
            affected_population: null,
          },
        ],
        hypotheses: [
          {
            signal_id: realId,
            statement: "Age moderates the treatment effect.",
            testable_prediction: "Effect is larger in patients under 65.",
            suggested_design: "Pre-registered subgroup meta-analysis by age band.",
            rationale: "Grounded in the heterogeneity signal.",
          },
          {
            signal_id: "sig-made-up",
            statement: "Ungrounded hypothesis.",
            testable_prediction: "should be dropped",
            suggested_design: "should be dropped",
            rationale: "cites no real signal",
          },
        ],
        synthesis: "The evidence pools but is inconsistent.",
      };
      return out;
    };

    const result = await generateHypotheses(
      fakePool,
      { topic: "Drug X reduces major cardiovascular events across trials." },
      { retrieve, llm }
    );

    expect(result.evidenceGrounded).toBe(true);
    expect(result.usedSources).toHaveLength(2);
    expect(result.signals.length).toBeGreaterThan(0);

    // Grounding gate: the invented gap + hypothesis are dropped, and counted.
    expect(result.gaps).toHaveLength(1);
    expect(result.hypotheses).toHaveLength(1);
    expect(result.droppedUngrounded).toBe(2);

    // Every surviving item cites a real derived signal.
    const ids = new Set(result.signals.map((s) => s.id));
    for (const g of result.gaps) expect(ids.has(g.signal_id)).toBe(true);
    for (const h of result.hypotheses) expect(ids.has(h.signal_id)).toBe(true);
  });

  it("produces a no_support_found signal (and targets the absence) when retrieval is empty", async () => {
    const retrieve: SourceRetriever = async () => [];
    const llm: HypothesesLlm = async () => ({
      gaps: [
        {
          signal_id: "sig-no-support",
          title: "No primary evidence indexed",
          why_gap: "The topic is unstudied in the cached sources.",
          affected_population: null,
        },
      ],
      hypotheses: [
        {
          signal_id: "sig-no-support",
          statement: "A primary RCT would establish the effect.",
          testable_prediction: "A phase 3 trial shows a benefit vs placebo.",
          suggested_design: "Randomised, double-blind, placebo-controlled trial.",
          rationale: "Grounded in the absence of any poolable evidence.",
        },
      ],
      synthesis: "No poolable evidence exists for this topic.",
    });

    const result = await generateHypotheses(
      fakePool,
      { topic: "Some off-distribution efficacy claim with no cached source." },
      { retrieve, llm }
    );

    expect(result.evidenceGrounded).toBe(false);
    expect(result.signals).toHaveLength(1);
    expect(result.signals[0].kind).toBe("no_support_found");
    expect(result.gaps).toHaveLength(1);
    expect(result.droppedUngrounded).toBe(0);
  });
});
