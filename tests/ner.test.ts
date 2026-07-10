import { describe, it, expect } from "vitest";

// Oracle test for BIOMEDICAL NER + ENTITY LINKING (native scispaCy port). Claude is
// stubbed via injected deps (no network / API key), so these assert the invariants that
// make the port trustworthy:
//   (1) GROUNDING DROP — a mention that is NOT a real substring of the input is dropped,
//       never asserted; a real mention survives with verbatim text + exact offsets.
//   (2) LINKING — a mention resolves to the correct normalized concept id (UMLS CUI /
//       MeSH id) via the in-code dictionary; a mention with no dictionary entry links to
//       a null id (unlinked) rather than being forced to a wrong concept.
//   (3) ABBREVIATION — a short-form mention links via its Schwartz-Hearst long form.

import {
  recognizeEntities,
  linkMention,
  findAbbreviations,
  type NerDeps,
} from "@/lib/entities/ner";
import type { RawMention } from "@/lib/entities/schemas";

function depsReturning(mentions: RawMention[]): NerDeps {
  return { extractMentions: async () => mentions };
}

describe("recognizeEntities — grounding drop invariant", () => {
  it("keeps a grounded mention with verbatim text + offsets, drops an ungroundable one", async () => {
    const text =
      "In this trial, metformin reduced HbA1c in patients with type 2 diabetes.";
    // "aspirin" is NOT in the text — a fabricated mention that must be dropped.
    const deps = depsReturning([
      { text: "metformin", type: "chemical" },
      { text: "type 2 diabetes", type: "disease" },
      { text: "aspirin", type: "chemical" },
    ]);

    const result = await recognizeEntities({ text }, deps);

    expect(result.groundingDroppedCount).toBe(1);
    const texts = result.entities.map((e) => e.text);
    expect(texts).toContain("metformin");
    expect(texts).toContain("type 2 diabetes");
    expect(texts).not.toContain("aspirin");

    // Offsets point at the real substring, and we return the verbatim located text.
    const metformin = result.entities.find((e) => e.text === "metformin")!;
    expect(text.slice(metformin.start, metformin.end)).toBe("metformin");
    expect(metformin.grounding.status).toBe("exact");
  });

  it("recovers verbatim source text even when the model alters whitespace", async () => {
    const text = "Patients with  type 2   diabetes were enrolled.";
    // Model collapses the internal whitespace runs.
    const deps = depsReturning([{ text: "type 2 diabetes", type: "disease" }]);

    const result = await recognizeEntities({ text }, deps);

    expect(result.groundingDroppedCount).toBe(0);
    expect(result.entities).toHaveLength(1);
    const ent = result.entities[0];
    // The returned text is the VERBATIM source substring, not the model's normalized one.
    expect(text.slice(ent.start, ent.end)).toBe(ent.text);
    expect(ent.text).toContain("type 2");
    expect(ent.grounding.status).toBe("approximate");
  });
});

describe("recognizeEntities — linking invariant", () => {
  it("links a known mention to its concept id and leaves an unknown one unlinked", async () => {
    const text = "Treatment with metformin was compared to a novel compound zorblatib.";
    const deps = depsReturning([
      { text: "metformin", type: "chemical" },
      { text: "zorblatib", type: "chemical" }, // not in the dictionary
    ]);

    const result = await recognizeEntities({ text }, deps);

    const metformin = result.entities.find((e) => e.text === "metformin")!;
    expect(metformin.link.normalizedId).toBe("C0025598");
    expect(metformin.link.canonicalName).toBe("Metformin");
    expect(metformin.link.score).toBe(1);

    const unknown = result.entities.find((e) => e.text === "zorblatib")!;
    expect(unknown.link.normalizedId).toBeNull();
    expect(unknown.link.score).toBe(0);

    expect(result.linkedCount).toBe(1);
  });

  it("links a case/whitespace-variant surface form to the right concept", async () => {
    const link = linkMention("Type 2 Diabetes", "disease");
    expect(link.normalizedId).toBe("C0011860");
    expect(link.score).toBe(1);
  });

  it("does not link a mention to a concept of the wrong type", async () => {
    // "MI" is a disease alias (myocardial infarction); tagged as a gene it must NOT link.
    const asGene = linkMention("MI", "gene");
    expect(asGene.normalizedId).toBeNull();
    const asDisease = linkMention("MI", "disease");
    expect(asDisease.normalizedId).toBe("C0027051");
  });
});

describe("findAbbreviations + abbreviation-resolved linking", () => {
  it("detects a Schwartz-Hearst long form ( SHORT ) pair", () => {
    const abbrevs = findAbbreviations(
      "Patients with myocardial infarction (MI) were followed for one year."
    );
    const mi = abbrevs.find((a) => a.short === "MI");
    expect(mi).toBeDefined();
    expect(mi!.long.toLowerCase()).toContain("myocardial infarction");
  });

  it("links a short-form mention via its resolved long form", async () => {
    const text =
      "Acute myocardial infarction (AMI) is a leading cause of death. AMI incidence rose.";
    // The second "AMI" is the short form; it must link via the long form's concept.
    const deps = depsReturning([{ text: "AMI", type: "disease" }]);

    const result = await recognizeEntities({ text }, deps);

    const ami = result.entities[0];
    expect(ami.abbreviationOf?.toLowerCase()).toContain("myocardial infarction");
    expect(ami.link.normalizedId).toBe("C0027051");
  });
});

describe("recognizeEntities — honest empty degradation", () => {
  it("returns an empty result when the extractor fails, never fabricating entities", async () => {
    const failing: NerDeps = {
      extractMentions: async () => {
        throw new Error("LLM unavailable");
      },
    };
    const result = await recognizeEntities({ text: "metformin lowers HbA1c." }, failing);
    expect(result.entities).toEqual([]);
    expect(result.linkedCount).toBe(0);
  });

  it("returns empty for blank input without calling the extractor", async () => {
    let called = false;
    const deps: NerDeps = {
      extractMentions: async () => {
        called = true;
        return [];
      },
    };
    const result = await recognizeEntities({ text: "   " }, deps);
    expect(result.entities).toEqual([]);
    expect(called).toBe(false);
  });
});
