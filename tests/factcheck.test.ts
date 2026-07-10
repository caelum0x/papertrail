import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SourceCandidate } from "@/lib/schemas";

// Pipeline test for the Loki / OpenFactVerification native port. We stub the two
// trust boundaries — Claude (callClaudeForJson) and retrieval (retrieveSources) —
// so no network / no API key is needed, then assert the real orchestration:
//   decompose -> checkworthy -> query-gen -> retrieve -> verify -> aggregate,
// plus the grounding invariant (a supported/refuted verdict whose quoted span
// can't be located in the source is dropped and downgraded to "unverified").

// callClaudeForJson is called once per step with a distinct Zod schema. We route
// the response by which schema keys are present, and let the real schema.parse run
// so the test also exercises validation.
const callClaudeForJson = vi.fn();
vi.mock("@/lib/claude", () => ({
  callClaudeForJson: (params: { schema: { parse: (v: unknown) => unknown }; user: string }) =>
    callClaudeForJson(params),
  CLAUDE_MODEL: "test-model",
}));

const retrieveSources = vi.fn();
vi.mock("@/lib/agents/retrievalAgent", () => ({
  retrieveSources: (query: string) => retrieveSources(query),
}));

const { runFactCheck } = await import("@/lib/factcheck/pipeline");

// A cached source whose raw_text contains the exact span the "verify" step will
// quote for the supported claim (so grounding succeeds).
const SUPPORT_TEXT =
  "In this randomized trial, Drug X reduced major cardiovascular events by 30% over 24 months.";
const REFUTE_TEXT =
  "The vaccine showed 67% efficacy against symptomatic infection; it was not 100% protective.";

function source(id: string, raw_text: string, external_id: string): SourceCandidate {
  return {
    id,
    source_type: "clinicaltrials",
    external_id,
    title: `Study ${external_id}`,
    raw_text,
    url: `https://clinicaltrials.gov/study/${external_id}`,
    similarity: 0.9,
    phase: null,
    enrollment_count: null,
    registered_results: null,
  };
}

// Route each Claude call by inspecting the user prompt (which step it belongs to).
// Returns objects that the real per-step Zod schemas accept.
function routeClaude(user: string): unknown {
  if (user.includes("Output the JSON now.") && user.startsWith("Text:")) {
    // decompose
    return {
      claims: [
        "Drug X reduced cardiovascular events by 30%.",
        "The vaccine is 100% effective.",
        "This therapy is the best available.",
      ],
    };
  }
  if (user.startsWith("Statements:")) {
    // checkworthiness — third claim is an opinion (not checkworthy)
    return {
      items: [
        { claim: "Drug X reduced cardiovascular events by 30%.", checkworthy: true, reason: "Quantitative, verifiable." },
        { claim: "The vaccine is 100% effective.", checkworthy: true, reason: "Verifiable efficacy claim." },
        { claim: "This therapy is the best available.", checkworthy: false, reason: "Subjective opinion." },
      ],
    };
  }
  if (user.startsWith("Claim:")) {
    // query generation
    return { queries: ["What was the effect size?", "What population?"] };
  }
  if (user.startsWith("CLAIM:")) {
    // verify — behavior depends on which source is embedded in the prompt
    if (user.includes("reduced major cardiovascular events by 30%")) {
      // Supported, with a span that EXISTS verbatim in SUPPORT_TEXT -> grounds.
      return {
        relationship: "supported",
        reasoning: "The trial reports the 30% reduction directly.",
        source_span: "Drug X reduced major cardiovascular events by 30%",
      };
    }
    if (user.includes("67% efficacy")) {
      // Refuted, but the quoted span is NOT present verbatim -> grounding drops it
      // and the verdict must be downgraded to "unverified".
      return {
        relationship: "refuted",
        reasoning: "Source shows 67%, contradicting the 100% claim.",
        source_span: "efficacy was measured at exactly one hundred percent",
      };
    }
  }
  throw new Error(`Unrouted Claude call: ${user.slice(0, 60)}`);
}

beforeEach(() => {
  callClaudeForJson.mockReset();
  retrieveSources.mockReset();

  callClaudeForJson.mockImplementation(
    ({ schema, user }: { schema: { parse: (v: unknown) => unknown }; user: string }) => {
      return Promise.resolve(schema.parse(routeClaude(user)));
    }
  );

  // Retrieval returns the matching cached source based on the claim text embedded
  // in the query. Query #1 is always the claim itself (Loki convention).
  retrieveSources.mockImplementation((query: string) => {
    if (query.includes("cardiovascular")) return Promise.resolve([source("s1", SUPPORT_TEXT, "NCT001")]);
    if (query.includes("vaccine")) return Promise.resolve([source("s2", REFUTE_TEXT, "NCT002")]);
    return Promise.resolve([]);
  });
});

describe("factcheck pipeline", () => {
  it("runs decompose -> per-claim verdict -> aggregate", async () => {
    const out = await runFactCheck("Drug X reduced cardiovascular events. The vaccine is 100% effective. Best therapy.");

    // Decompose produced 3 claims.
    expect(out.claims).toHaveLength(3);
    expect(out.summary.num_claims).toBe(3);

    // Checkworthiness: two checkworthy, one opinion skipped.
    expect(out.summary.num_checkworthy).toBe(2);
    const opinion = out.claims.find((c) => !c.checkworthy);
    expect(opinion?.verdict).toBe("not_checkworthy");
    expect(opinion?.evidence).toHaveLength(0);

    // Supported claim: grounded span located -> verdict "supported", factuality 1.
    const supported = out.claims.find((c) => c.claim.includes("cardiovascular"));
    expect(supported?.verdict).toBe("supported");
    expect(supported?.factuality).toBe(1);
    expect(supported?.evidence[0].source_span).toContain("Drug X reduced major cardiovascular events by 30%");
    expect(supported?.evidence[0].span_start).toBeGreaterThanOrEqual(0);
    expect(supported?.grounding_dropped_count).toBe(0);

    // Query list starts with the claim itself (Loki convention).
    expect(supported?.queries[0]).toBe("Drug X reduced cardiovascular events by 30%.");
  });

  it("drops an ungroundable span and downgrades the verdict to unverified", async () => {
    const out = await runFactCheck("Drug X reduced cardiovascular events. The vaccine is 100% effective. Best therapy.");

    const vaccine = out.claims.find((c) => c.claim.includes("vaccine"));
    // Model said "refuted" with a span not present in the source -> dropped.
    expect(vaccine?.grounding_dropped_count).toBe(1);
    expect(vaccine?.evidence[0].relationship).toBe("unverified");
    expect(vaccine?.evidence[0].source_span).toBeNull();
    // No supported/refuted grounded evidence -> claim is unverified, factuality null.
    expect(vaccine?.verdict).toBe("unverified");
    expect(vaccine?.factuality).toBeNull();
  });

  it("aggregates overall factuality only over verified claims", async () => {
    const out = await runFactCheck("Drug X reduced cardiovascular events. The vaccine is 100% effective. Best therapy.");

    // Only the supported claim is 'verified' (factuality !== null); vaccine is
    // unverified (dropped span), opinion is not checkworthy.
    expect(out.summary.num_verified).toBe(1);
    expect(out.summary.num_supported).toBe(1);
    expect(out.summary.num_refuted).toBe(0);
    expect(out.summary.factuality).toBe(1);
  });

  it("reports unverified when no confident source is cached", async () => {
    retrieveSources.mockResolvedValue([]);
    const out = await runFactCheck("Drug X reduced cardiovascular events. The vaccine is 100% effective. Best therapy.");

    const supported = out.claims.find((c) => c.claim.includes("cardiovascular"));
    expect(supported?.evidence).toHaveLength(0);
    expect(supported?.verdict).toBe("unverified");
    expect(supported?.factuality).toBeNull();
    expect(out.summary.factuality).toBeNull();
  });
});
