import { describe, it, expect, vi } from "vitest";
import {
  outlineThenWrite,
  OutlineDraftSchema,
  SectionProseSchema,
  type OutlineClaudeCaller,
} from "../lib/synthesis/outline";

// Native STORM outline-then-write port, driven end to end with an INJECTED Claude caller
// (no live API/DB/embeddings). The mock returns:
//   - STAGE 1+2: a multi-perspective outline with two sections.
//   - STAGE 3 (per section): prose mixing a GROUNDABLE factual sentence (quote present in
//     a source), an UNgroundable one (quote absent -> dropped), and a connective one.
// Asserts outline -> per-section grounded writing, and that ungrounded claims are dropped
// while grounded prose + its citation survive.

const GROUNDABLE_A = "hospitalization for heart failure was reduced";
const GROUNDABLE_B = "no increase in serious adverse events was observed";

const SOURCES = [
  { id: "s1", title: "Trial 1", text: `In trial 1, ${GROUNDABLE_A} versus placebo.` },
  { id: "s2", title: "Trial 2", text: `In the safety analysis, ${GROUNDABLE_B}.` },
];

const OUTLINE = {
  perspectives: ["Clinical trialist", "Safety reviewer"],
  sections: [
    { heading: "Efficacy", query: "What efficacy did the trials show?" },
    { heading: "Safety", query: "What safety signals were reported?" },
  ],
};

// Per-heading section prose the mock returns. Each has one groundable factual sentence,
// one connective sentence, and (Efficacy only) one ungroundable factual sentence.
const SECTION_PROSE: Record<string, { sentences: { text: string; citations: (string | number)[]; source_quote: string | null }[] }> = {
  Efficacy: {
    sentences: [
      { text: "Heart failure is a leading cause of hospitalization.", citations: [], source_quote: null },
      { text: "The treatment reduced heart-failure hospitalization.", citations: [1], source_quote: GROUNDABLE_A },
      {
        text: "One trial reported a 99% cure rate found in no source.",
        citations: [1],
        source_quote: "a 99% cure rate found in no source",
      },
    ],
  },
  Safety: {
    sentences: [
      { text: "Safety was assessed across the program.", citations: [], source_quote: null },
      { text: "Serious adverse events did not increase with treatment.", citations: [2], source_quote: GROUNDABLE_B },
    ],
  },
};

// A single injected caller that answers both stages based on the system prompt it sees:
// the outline system prompt -> OUTLINE; a section system prompt -> that heading's prose.
// Distinguish the two Claude stages by the schema reference passed in. The caller's
// `schema` param is a generic validator, so we compare via an unknown cast.
function isOutlineSchema(schema: unknown): boolean {
  return (schema as unknown) === (OutlineDraftSchema as unknown);
}

function makeCaller(): OutlineClaudeCaller {
  return async (args) => {
    if (isOutlineSchema(args.schema)) {
      return OutlineDraftSchema.parse(OUTLINE) as never;
    }
    // Section stage: identify which section from the heading embedded in the user prompt.
    const heading = args.user.includes("SECTION HEADING: Efficacy") ? "Efficacy" : "Safety";
    return SectionProseSchema.parse(SECTION_PROSE[heading]) as never;
  };
}

const TOPIC = "SGLT2 inhibitors reduce heart-failure hospitalization in type 2 diabetes.";

describe("outlineThenWrite (native STORM port)", () => {
  it("produces a multi-perspective outline, then writes each section grounded in sources", async () => {
    const callClaude = makeCaller();
    const result = await outlineThenWrite({ topic: TOPIC, sources: SOURCES }, { callClaude });

    // STAGE 1+2 — outline carries perspectives + one heading per section.
    expect(result.outline.perspectives).toEqual(["Clinical trialist", "Safety reviewer"]);
    expect(result.outline.headings).toEqual(["Efficacy", "Safety"]);

    // STAGE 3 — one written section per outline heading, in order.
    expect(result.sections.map((s) => s.heading)).toEqual(["Efficacy", "Safety"]);
  });

  it("keeps grounded prose with its citation and drops ungroundable factual sentences", async () => {
    const callClaude = makeCaller();
    const result = await outlineThenWrite({ topic: TOPIC, sources: SOURCES }, { callClaude });

    const efficacy = result.sections.find((s) => s.heading === "Efficacy");
    const safety = result.sections.find((s) => s.heading === "Safety");
    expect(efficacy).toBeDefined();
    expect(safety).toBeDefined();

    // Groundable factual sentence + connective sentence survive.
    expect(efficacy?.content).toContain("reduced heart-failure hospitalization");
    expect(efficacy?.content).toContain("leading cause of hospitalization");
    // Its citation grounds back to the source that actually contains the quote.
    expect(efficacy?.citations).toContain("s1");

    // The ungroundable factual sentence was dropped, not kept anywhere.
    const fabricatedPresent = result.sections.some((s) => s.content.includes("99% cure rate"));
    expect(fabricatedPresent).toBe(false);
    expect(result.droppedCount).toBe(1);

    // Safety section grounds its factual sentence to the safety source.
    expect(safety?.content).toContain("did not increase with treatment");
    expect(safety?.citations).toContain("s2");
  });

  it("grounds a factual sentence to the true source even if mis-attributed", async () => {
    // Cite the WRONG source (s2) for a quote that only appears in s1; grounding must still
    // locate it and attribute it to s1 — the native trust invariant, not the model's word.
    const misattributed: OutlineClaudeCaller = async (args) => {
      if (isOutlineSchema(args.schema)) {
        return OutlineDraftSchema.parse({
          perspectives: [],
          sections: [{ heading: "Efficacy", query: "efficacy" }],
        }) as never;
      }
      return SectionProseSchema.parse({
        sentences: [{ text: "Treatment reduced hospitalization.", citations: [2], source_quote: GROUNDABLE_A }],
      }) as never;
    };

    const result = await outlineThenWrite({ topic: TOPIC, sources: SOURCES }, { callClaude: misattributed });
    const efficacy = result.sections[0];
    expect(efficacy.content).toContain("reduced hospitalization");
    expect(efficacy.citations).toEqual(["s1"]);
    expect(result.droppedCount).toBe(0);
  });

  it("assigns stable 1-based ids when sources have none", async () => {
    const noId: OutlineClaudeCaller = async (args) => {
      if (isOutlineSchema(args.schema)) {
        return OutlineDraftSchema.parse({
          perspectives: [],
          sections: [{ heading: "Efficacy", query: "efficacy" }],
        }) as never;
      }
      return SectionProseSchema.parse({
        sentences: [{ text: "Reduced.", citations: [1], source_quote: GROUNDABLE_A }],
      }) as never;
    };

    const result = await outlineThenWrite(
      { topic: TOPIC, sources: [{ text: `x ${GROUNDABLE_A} y` }] },
      { callClaude: noId }
    );
    expect(result.sections[0].citations).toEqual(["1"]);
  });

  it("validates input at the boundary", async () => {
    const callClaude = vi.fn();
    await expect(
      outlineThenWrite({ topic: "too short", sources: SOURCES }, { callClaude })
    ).rejects.toThrow();
    // Rejected before any model call.
    expect(callClaude).not.toHaveBeenCalled();
  });
});
