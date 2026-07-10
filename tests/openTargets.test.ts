import { describe, it, expect, vi } from "vitest";
import {
  resolveTarget,
  resolveDisease,
  targetDiseaseEvidence,
  summarizeEvidence,
  type OpenTargetsDeps,
} from "../lib/bio/openTargets";
import { TargetDiseaseEvidenceSchema } from "../lib/bio/targets.schemas";

// These tests exercise the Open Targets layer over a MOCKED GraphQL fetcher — no
// live network. The contract under test: the DETERMINISTIC scores from the API are
// parsed and returned VERBATIM, and a pair with no scored association yields an
// HONEST empty result (never a fabricated number). The optional Claude summary is
// tested with a mocked callJson so no real LLM call is made either.

const ENSEMBL = "ENSG00000169174"; // PCSK9
const EFO = "EFO_0004911"; // hypercholesterolemia (example EFO id)

// A GraphQL router: dispatches on which query is being run and returns the
// matching mocked `data` payload — the same shape the real endpoint returns.
function makeGraphql(config: {
  targetHit?: Record<string, unknown> | null;
  diseaseHit?: Record<string, unknown> | null;
  association?: unknown;
}): OpenTargetsDeps["graphql"] {
  return vi.fn(async (query: string) => {
    if (query.includes("ResolveTarget")) {
      return {
        search: { hits: config.targetHit ? [{ object: config.targetHit }] : [] },
      };
    }
    if (query.includes("ResolveDisease")) {
      return {
        search: { hits: config.diseaseHit ? [{ object: config.diseaseHit }] : [] },
      };
    }
    // TargetDiseaseAssociation
    return config.association ?? {};
  });
}

const RESOLVED_TARGET_HIT = {
  id: ENSEMBL,
  approvedSymbol: "PCSK9",
  approvedName: "proprotein convertase subtilisin/kexin type 9",
};
const RESOLVED_DISEASE_HIT = { id: EFO, name: "hypercholesterolemia" };

// A full mocked association payload: an overall score of 0.82, per-datatype
// scores, one known drug, and a tractability row.
const ASSOCIATION_PAYLOAD = {
  disease: {
    id: EFO,
    associatedTargets: {
      rows: [
        {
          score: 0.82,
          datatypeScores: [
            { id: "genetic_association", score: 0.91 },
            { id: "known_drug", score: 0.75 },
            { id: "literature", score: 0.4 },
            { id: "animal_model", score: 0.33 },
            // An unmapped datatype must be ignored, not surfaced.
            { id: "somatic_mutation", score: 0.99 },
          ],
        },
      ],
    },
  },
  target: {
    id: ENSEMBL,
    knownDrugs: {
      rows: [
        {
          drugId: "CHEMBL3833367",
          prefName: "Evolocumab",
          mechanismOfAction: "PCSK9 inhibitor",
          phase: 4,
          status: "Completed",
        },
        // Duplicate (same drugId + mechanism) — must dedupe to one row.
        {
          drugId: "CHEMBL3833367",
          prefName: "Evolocumab",
          mechanismOfAction: "PCSK9 inhibitor",
          phase: 4,
          status: "Completed",
        },
      ],
    },
    tractability: [
      { label: "Approved Drug", modality: "SM", value: true },
      { label: "UniProt loc high conf", modality: "AB", value: false },
    ],
  },
};

describe("openTargets — entity resolution", () => {
  it("resolves a target symbol to its Ensembl gene id", async () => {
    const graphql = makeGraphql({ targetHit: RESOLVED_TARGET_HIT });
    const resolved = await resolveTarget("PCSK9", { graphql });

    expect(resolved.ensemblId).toBe(ENSEMBL);
    expect(resolved.approvedSymbol).toBe("PCSK9");
    expect(resolved.querySymbol).toBe("PCSK9");
  });

  it("resolves a disease name to its EFO id", async () => {
    const graphql = makeGraphql({ diseaseHit: RESOLVED_DISEASE_HIT });
    const resolved = await resolveDisease("hypercholesterolemia", { graphql });

    expect(resolved.efoId).toBe(EFO);
    expect(resolved.name).toBe("hypercholesterolemia");
  });

  it("returns an honest null id when nothing matches (no fabrication)", async () => {
    const graphql = makeGraphql({ targetHit: null });
    const resolved = await resolveTarget("NOTAREALGENE", { graphql });

    expect(resolved.ensemblId).toBeNull();
    expect(resolved.approvedSymbol).toBeNull();
  });
});

describe("targetDiseaseEvidence — deterministic scores returned verbatim", () => {
  it("parses and returns the API scores faithfully, verbatim", async () => {
    const graphql = makeGraphql({
      targetHit: RESOLVED_TARGET_HIT,
      diseaseHit: RESOLVED_DISEASE_HIT,
      association: ASSOCIATION_PAYLOAD,
    });

    const evidence = await targetDiseaseEvidence("PCSK9", "hypercholesterolemia", {
      graphql,
    });

    // Shape is exactly what the schema promises.
    expect(() => TargetDiseaseEvidenceSchema.parse(evidence)).not.toThrow();

    expect(evidence.found).toBe(true);
    // Overall + per-datatype scores are the API's numbers, untouched.
    expect(evidence.overallScore).toBe(0.82);
    expect(evidence.datatypeScores).toEqual({
      genetic_association: 0.91,
      known_drug: 0.75,
      literature: 0.4,
      animal_model: 0.33,
    });

    // Unmapped datatype (somatic_mutation) is NOT surfaced.
    expect(Object.keys(evidence.datatypeScores)).toEqual([
      "genetic_association",
      "known_drug",
      "literature",
      "animal_model",
    ]);

    // Known drugs deduped to one; fields verbatim.
    expect(evidence.knownDrugs).toHaveLength(1);
    expect(evidence.knownDrugs[0]).toMatchObject({
      drugName: "Evolocumab",
      mechanismOfAction: "PCSK9 inhibitor",
      phase: 4,
    });

    // Tractability rows carried through with their boolean value.
    expect(evidence.tractability).toContainEqual({
      label: "Approved Drug",
      modality: "SM",
      value: true,
    });
  });

  it("clamps an out-of-range score to null rather than fabricating a value", async () => {
    const graphql = makeGraphql({
      targetHit: RESOLVED_TARGET_HIT,
      diseaseHit: RESOLVED_DISEASE_HIT,
      association: {
        disease: {
          id: EFO,
          associatedTargets: {
            rows: [
              {
                score: 0.5,
                datatypeScores: [{ id: "literature", score: 1.7 }], // impossible
              },
            ],
          },
        },
        target: { id: ENSEMBL, knownDrugs: { rows: [] }, tractability: [] },
      },
    });

    const evidence = await targetDiseaseEvidence("PCSK9", "hypercholesterolemia", {
      graphql,
    });
    expect(evidence.datatypeScores.literature).toBeNull();
  });
});

describe("targetDiseaseEvidence — honest no-association case", () => {
  it("returns found:false with null scores when the pair has no scored association", async () => {
    const graphql = makeGraphql({
      targetHit: RESOLVED_TARGET_HIT,
      diseaseHit: RESOLVED_DISEASE_HIT,
      association: {
        disease: { id: EFO, associatedTargets: { rows: [] } }, // no rows
        target: { id: ENSEMBL, knownDrugs: { rows: [] }, tractability: [] },
      },
    });

    const evidence = await targetDiseaseEvidence("PCSK9", "some_unrelated_disease", {
      graphql,
    });

    expect(evidence.found).toBe(false);
    expect(evidence.overallScore).toBeNull();
    expect(evidence.datatypeScores).toEqual({
      genetic_association: null,
      known_drug: null,
      literature: null,
      animal_model: null,
    });
    expect(evidence.knownDrugs).toEqual([]);
  });

  it("returns found:false when an id fails to resolve (no association fetched)", async () => {
    const graphql = makeGraphql({
      targetHit: null, // target doesn't resolve
      diseaseHit: RESOLVED_DISEASE_HIT,
    });

    const evidence = await targetDiseaseEvidence("NOTAREALGENE", "hypercholesterolemia", {
      graphql,
    });

    expect(evidence.found).toBe(false);
    expect(evidence.target.ensemblId).toBeNull();
    expect(evidence.overallScore).toBeNull();
    // The association query is never run once resolution fails.
    expect(
      (graphql as ReturnType<typeof vi.fn>).mock.calls.some((c) =>
        String(c[0]).includes("TargetDiseaseAssociation")
      )
    ).toBe(false);
  });

  it("degrades to an honest empty result when the network fetcher fails", async () => {
    const graphql = vi.fn(async () => null); // simulate upstream failure
    const evidence = await targetDiseaseEvidence("PCSK9", "hypercholesterolemia", {
      graphql,
    });

    expect(evidence.found).toBe(false);
    expect(evidence.overallScore).toBeNull();
    expect(evidence.target.ensemblId).toBeNull();
  });
});

describe("summarizeEvidence — optional Claude layer references only returned data", () => {
  it("passes the deterministic scores to the model and validates the JSON summary", async () => {
    const graphql = makeGraphql({
      targetHit: RESOLVED_TARGET_HIT,
      diseaseHit: RESOLVED_DISEASE_HIT,
      association: ASSOCIATION_PAYLOAD,
    });
    const evidence = await targetDiseaseEvidence("PCSK9", "hypercholesterolemia", {
      graphql,
    });

    // Mocked callJson: capture the prompt and return a schema-valid summary.
    const callJson = vi.fn(async (params: { user: string; schema: { parse: (v: unknown) => unknown } }) => {
      // The prompt must carry the deterministic overall score verbatim.
      expect(params.user).toContain("0.820");
      return params.schema.parse({
        summary: "Strong genetic association between PCSK9 and hypercholesterolemia.",
        strongestDatatype: "genetic_association",
      });
    });

    const summary = await summarizeEvidence(evidence, callJson as never);

    expect(callJson).toHaveBeenCalledTimes(1);
    expect(summary.strongestDatatype).toBe("genetic_association");
    expect(summary.summary.length).toBeGreaterThan(0);
  });

  it("rejects a model summary that invents a datatype outside the returned set", async () => {
    const graphql = makeGraphql({
      targetHit: RESOLVED_TARGET_HIT,
      diseaseHit: RESOLVED_DISEASE_HIT,
      association: ASSOCIATION_PAYLOAD,
    });
    const evidence = await targetDiseaseEvidence("PCSK9", "hypercholesterolemia", {
      graphql,
    });

    // A model that returns an unknown datatype must fail Zod validation, not pass.
    const callJson = vi.fn(async (params: { schema: { parse: (v: unknown) => unknown } }) =>
      params.schema.parse({ summary: "bad", strongestDatatype: "somatic_mutation" })
    );

    await expect(summarizeEvidence(evidence, callJson as never)).rejects.toThrow();
  });
});
