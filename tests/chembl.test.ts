import { describe, it, expect } from "vitest";
import {
  classifyBioactivity,
  comparePotency,
  comparePhase,
  resolveMolecule,
  targetBioactivities,
  verifyBioactivityClaim,
  CHEMBL_ATTRIBUTION,
  POTENCY_BAND_ORDERS,
  type ChemblDeps,
  type FetchLike,
} from "../lib/bio/chembl";
import type { Bioactivity, ResolvedMolecule } from "../lib/bio/chembl.schemas";

// Deterministic bioactivity verification over MOCKED ChEMBL responses — no network.
// Locks the documented order-of-magnitude potency band, phase over/understatement, and
// honest not_found. Mirrors tests/geneticAssociation.test.ts (pure verdict logic) and
// tests/openTargets.test.ts (injected fetcher for the network layer).

// --- Helpers -------------------------------------------------------------------

function activity(over: Partial<Bioactivity> = {}): Bioactivity {
  return {
    targetChemblId: "CHEMBL279",
    targetName: "Vascular endothelial growth factor receptor 2",
    standardType: "IC50",
    standardValue: 3,
    standardUnits: "nM",
    pChembl: 8.5,
    ...over,
  };
}

function molecule(over: Partial<ResolvedMolecule> = {}): ResolvedMolecule {
  return {
    queryName: "imatinib",
    chemblId: "CHEMBL941",
    prefName: "IMATINIB",
    maxPhase: 4,
    ...over,
  };
}

// A fetcher that dispatches on the URL substring so resolve + activity are both stubbed.
function makeFetch(map: {
  molecules?: unknown;
  activities?: unknown;
}): FetchLike {
  return async (url: string) => {
    const body = url.includes("/molecule/search")
      ? { molecules: map.molecules ?? [] }
      : { activities: map.activities ?? [] };
    return {
      ok: true,
      status: 200,
      json: async () => body,
    };
  };
}

// --- comparePotency: the order-of-magnitude band -------------------------------

describe("comparePotency — order-of-magnitude band on nM", () => {
  it("claimed 5 nM vs measured 3 nM → confirmed_within_order", () => {
    const r = comparePotency(5, activity({ standardValue: 3 }));
    expect(r.verdict).toBe("confirmed_within_order");
    expect(r.claimedNM).toBe(5);
    expect(r.measuredNM).toBe(3);
    expect(r.bandOrders).toBe(POTENCY_BAND_ORDERS);
  });

  it("claimed 0.1 nM vs measured 50 nM → overstated (claim asserts far more potent)", () => {
    const r = comparePotency(0.1, activity({ standardValue: 50 }));
    expect(r.verdict).toBe("overstated");
    expect(r.ratio).toBeCloseTo(0.1 / 50, 10);
  });

  it("claimed 5000 nM vs measured 3 nM → understated (claim asserts far weaker)", () => {
    const r = comparePotency(5000, activity({ standardValue: 3 }));
    expect(r.verdict).toBe("understated");
  });

  it("exactly 10x weaker is still within the (inclusive) one-order band → confirmed", () => {
    const r = comparePotency(30, activity({ standardValue: 3 }));
    expect(r.verdict).toBe("confirmed_within_order");
    expect(r.ratio).toBeCloseTo(10, 10);
  });

  it("just past 10x (ratio > 10) → understated", () => {
    const r = comparePotency(30.1, activity({ standardValue: 3 }));
    expect(r.verdict).toBe("understated");
  });

  it("no measured activity → not_found (honest empty, never a guess)", () => {
    const r = comparePotency(5, null);
    expect(r.verdict).toBe("not_found");
    expect(r.measuredNM).toBeNull();
  });

  it("no claim → not_found", () => {
    const r = comparePotency(undefined, activity({ standardValue: 3 }));
    expect(r.verdict).toBe("not_found");
    expect(r.claimedNM).toBeNull();
  });
});

// --- comparePhase: over / under / confirmed ------------------------------------

describe("comparePhase — claimed vs ChEMBL max_phase", () => {
  it("claimed 4 vs max_phase 4 → confirmed", () => {
    expect(comparePhase(4, 4).verdict).toBe("confirmed");
  });

  it("claimed 3 vs max_phase 1 → overstated (drug not as far along as claimed)", () => {
    const r = comparePhase(3, 1);
    expect(r.verdict).toBe("overstated");
    expect(r.claimedPhase).toBe(3);
    expect(r.chemblMaxPhase).toBe(1);
  });

  it("claimed 1 vs max_phase 4 → understated", () => {
    expect(comparePhase(1, 4).verdict).toBe("understated");
  });

  it("no ChEMBL max_phase → not_found (never fabricate a phase)", () => {
    expect(comparePhase(2, null).verdict).toBe("not_found");
  });

  it("no claimed phase → not_found", () => {
    expect(comparePhase(undefined, 4).verdict).toBe("not_found");
  });
});

// --- classifyBioactivity: target filtering + mechanism + rationale -------------

describe("classifyBioactivity — combined deterministic verdict", () => {
  it("filters activities to the claimed target and confirms a matching potency", () => {
    const acts: Bioactivity[] = [
      activity({ targetName: "BRAF", standardValue: 4 }),
      activity({ targetName: "EGFR", standardValue: 0.5 }), // off-target, more potent
    ];
    const r = classifyBioactivity({
      drug: "vemurafenib",
      molecule: molecule({ chemblId: "CHEMBL1229517", maxPhase: 4 }),
      target: "BRAF",
      claimedPotencyNM: 5,
      claimedPhase: 4,
      activities: acts,
    });
    // Must compare against the BRAF measurement (4 nM), NOT the more-potent EGFR row.
    expect(r.potency.measuredNM).toBe(4);
    expect(r.potency.verdict).toBe("confirmed_within_order");
    expect(r.phase.verdict).toBe("confirmed");
    expect(r.mechanism.verdict).toBe("consistent");
    expect(r.mechanism.matchedTarget).toBe("BRAF");
    expect(r.attribution).toBe(CHEMBL_ATTRIBUTION);
  });

  it("claimed mechanism/target absent from ChEMBL activities → mechanism unverified + potency not_found", () => {
    const r = classifyBioactivity({
      drug: "drugX",
      molecule: molecule({ maxPhase: 2 }),
      target: "NONEXISTENT_TARGET",
      claimedPotencyNM: 5,
      activities: [activity({ targetName: "BRAF", standardValue: 3 })],
    });
    expect(r.mechanism.verdict).toBe("unverified");
    // No BRAF-target match for the NONEXISTENT_TARGET claim → nothing to compare.
    expect(r.potency.verdict).toBe("not_found");
  });

  it("no target claimed → uses the most-potent overall measurement", () => {
    const r = classifyBioactivity({
      drug: "drugX",
      molecule: molecule(),
      claimedPotencyNM: 2,
      activities: [
        activity({ targetName: "A", standardValue: 100 }),
        activity({ targetName: "B", standardValue: 3 }),
      ],
    });
    expect(r.potency.measuredNM).toBe(3);
    expect(r.potency.verdict).toBe("confirmed_within_order");
  });

  it("no claims at all → every arm not_found / not_claimed (honest empty)", () => {
    const r = classifyBioactivity({
      drug: "aspirin",
      molecule: molecule({ maxPhase: null }),
      activities: [],
    });
    expect(r.potency.verdict).toBe("not_found");
    expect(r.phase.verdict).toBe("not_found");
    expect(r.mechanism.verdict).toBe("not_claimed");
    expect(r.supporting).toEqual([]);
  });
});

// --- Network layer over an injected fetcher (offline) --------------------------

describe("resolveMolecule / targetBioactivities — injected fetcher", () => {
  it("resolves a molecule to chembl_id + pref_name + max_phase", async () => {
    const deps: ChemblDeps = {
      fetch: makeFetch({
        molecules: [
          { molecule_chembl_id: "CHEMBL941", pref_name: "IMATINIB", max_phase: 4 },
        ],
      }),
    };
    const m = await resolveMolecule("imatinib", deps);
    expect(m.chemblId).toBe("CHEMBL941");
    expect(m.prefName).toBe("IMATINIB");
    expect(m.maxPhase).toBe(4);
  });

  it("unresolvable name → honest empty molecule (chemblId null, no fabricated phase)", async () => {
    const deps: ChemblDeps = { fetch: makeFetch({ molecules: [] }) };
    const m = await resolveMolecule("not-a-real-drug", deps);
    expect(m.chemblId).toBeNull();
    expect(m.maxPhase).toBeNull();
  });

  it("keeps only potency endpoints with a usable value; drops non-potency assays", async () => {
    const deps: ChemblDeps = {
      fetch: makeFetch({
        activities: [
          { target_pref_name: "BRAF", standard_type: "IC50", standard_value: 31, standard_units: "nM", pchembl_value: 7.5 },
          { target_pref_name: "BRAF", standard_type: "Solubility", standard_value: 10, standard_units: "ug.mL-1" },
          { target_pref_name: "BRAF", standard_type: "Ki", standard_value: null, standard_units: "nM" },
        ],
      }),
    };
    const acts = await targetBioactivities("CHEMBL1229517", deps);
    expect(acts).toHaveLength(1);
    expect(acts[0].standardType).toBe("IC50");
    expect(acts[0].standardValue).toBe(31);
  });

  it("upstream failure (non-2xx) → empty activities, never fabricated", async () => {
    const failing: FetchLike = async () => ({ ok: false, status: 500, json: async () => ({}) });
    const acts = await targetBioactivities("CHEMBL1", { fetch: failing });
    expect(acts).toEqual([]);
  });
});

// --- End-to-end verifyBioactivityClaim over the mocked API ---------------------

describe("verifyBioactivityClaim — end-to-end over mocked ChEMBL", () => {
  it("claimed 5 nM / target match / phase 4 → confirmed on all axes", async () => {
    const deps: ChemblDeps = {
      fetch: makeFetch({
        molecules: [{ molecule_chembl_id: "CHEMBL1229517", pref_name: "VEMURAFENIB", max_phase: 4 }],
        activities: [
          { target_chembl_id: "CHEMBL5145", target_pref_name: "Serine/threonine-protein kinase B-raf", standard_type: "IC50", standard_value: 3, standard_units: "nM", pchembl_value: 8.5 },
        ],
      }),
    };
    const r = await verifyBioactivityClaim(
      { drug: "vemurafenib", target: "B-raf", claimedPotencyNM: 5, claimedPhase: 4 },
      deps
    );
    expect(r.molecule.chemblId).toBe("CHEMBL1229517");
    expect(r.potency.verdict).toBe("confirmed_within_order");
    expect(r.phase.verdict).toBe("confirmed");
    expect(r.mechanism.verdict).toBe("consistent");
    expect(r.attribution).toBe(CHEMBL_ATTRIBUTION);
  });

  it("overstated potency AND overstated phase caught end-to-end", async () => {
    const deps: ChemblDeps = {
      fetch: makeFetch({
        molecules: [{ molecule_chembl_id: "CHEMBL9", pref_name: "DRUGX", max_phase: 1 }],
        activities: [
          { target_pref_name: "KINASE", standard_type: "Ki", standard_value: 50, standard_units: "nM", pchembl_value: 7.3 },
        ],
      }),
    };
    const r = await verifyBioactivityClaim(
      { drug: "drugX", target: "KINASE", claimedPotencyNM: 0.1, claimedPhase: 3 },
      deps
    );
    expect(r.potency.verdict).toBe("overstated");
    expect(r.phase.verdict).toBe("overstated");
  });

  it("unresolvable drug → honest not_found across arms, no throw", async () => {
    const deps: ChemblDeps = { fetch: makeFetch({ molecules: [] }) };
    const r = await verifyBioactivityClaim(
      { drug: "totally-made-up", claimedPotencyNM: 5, claimedPhase: 3 },
      deps
    );
    expect(r.molecule.chemblId).toBeNull();
    expect(r.potency.verdict).toBe("not_found");
    expect(r.phase.verdict).toBe("not_found");
    expect(r.supporting).toEqual([]);
  });
});
