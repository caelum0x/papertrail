import { describe, it, expect, vi } from "vitest";
import {
  assembleRepurposingEvidence,
  scoreRepurposing,
  summarizeRepurposing,
  type ChemblMechanism,
  type RepurposingDeps,
} from "../lib/bio/repurposing";
import { RepurposingEvidenceSchema } from "../lib/bio/repurposing.schemas";
import type { SafetySignalAssessment } from "../lib/bio/pharmacovigilance";
import type { TargetDiseaseEvidence } from "../lib/bio/targets.schemas";
import type { TrialRecord } from "../lib/sources/clinicaltrials";

// These tests exercise the DRUG-REPURPOSING bundle over MOCKED component signals — no
// live network, no real LLM. The contract under test: the composite score + verdict
// are a DETERMINISTIC function of the assembled signals (strong when the target
// associates + mechanism is known + no failed trials; discouraged when a failed trial
// or safety signal exists), and every component degrades to an honest empty signal on
// failure rather than fabricating a value.

// --- Signal builders ---------------------------------------------------------

function targetEvidence(over: Partial<TargetDiseaseEvidence> = {}): TargetDiseaseEvidence {
  return {
    found: true,
    target: { querySymbol: "T", ensemblId: "ENSG1", approvedSymbol: "T", approvedName: "T" },
    disease: { queryName: "D", efoId: "EFO_1", name: "D" },
    overallScore: 0.7,
    datatypeScores: {
      genetic_association: 0.9,
      known_drug: null,
      literature: null,
      animal_model: null,
    },
    knownDrugs: [],
    tractability: [],
    ...over,
  };
}

function chembl(over: Partial<ChemblMechanism> = {}): ChemblMechanism {
  return {
    chemblId: "CHEMBL25",
    maxPhase: 4,
    mechanismOfAction: "Target inhibitor",
    hasTargetBioactivity: true,
    targetSymbol: "T",
    ...over,
  };
}

function trial(over: Partial<TrialRecord> & { overallStatus?: string } = {}): TrialRecord {
  const base: TrialRecord = {
    nctId: "NCT0001",
    title: "A trial",
    summaryText: "",
    url: "https://clinicaltrials.gov/study/NCT0001",
    phase: "PHASE2",
    enrollmentCount: 100,
  };
  // Cast to carry the extra `overallStatus` the engine reads defensively off the record.
  return { ...base, ...(over as Record<string, unknown>) } as TrialRecord;
}

function safety(over: Partial<SafetySignalAssessment> = {}): SafetySignalAssessment {
  return {
    drug: "drug",
    event: "event",
    a: 5,
    b: 100,
    c: 50,
    d: 10000,
    n: 10155,
    prr: 1.2,
    prrCiLower: 0.9,
    prrCiUpper: 1.6,
    ror: 1.2,
    rorCiLower: 0.9,
    rorCiUpper: 1.6,
    chiSquared: 1,
    chiSquaredYates: 0.5,
    pValue: 0.5,
    informationComponent: 0.1,
    ic025: -0.5,
    signal: false,
    ...over,
  };
}

// Build a deps object from mocked component results.
function makeDeps(config: {
  target?: TargetDiseaseEvidence;
  targetThrows?: boolean;
  chembl?: ChemblMechanism | null;
  trials?: TrialRecord[];
  safety?: SafetySignalAssessment | null;
}): RepurposingDeps {
  return {
    targetDiseaseEvidence: vi.fn(async () => {
      if (config.targetThrows) throw new Error("open targets down");
      return config.target ?? targetEvidence();
    }) as unknown as RepurposingDeps["targetDiseaseEvidence"],
    chemblLookup: vi.fn(async () =>
      config.chembl === undefined ? chembl() : config.chembl
    ),
    searchTrials: vi.fn(async () => config.trials ?? []) as unknown as RepurposingDeps["searchTrials"],
    assessSafetySignal: vi.fn(async () =>
      config.safety === undefined ? safety() : config.safety
    ) as unknown as RepurposingDeps["assessSafetySignal"],
  };
}

describe("scoreRepurposing — deterministic composite + verdict", () => {
  const strongTargets = {
    targetSymbol: "T",
    associationFound: true,
    overallScore: 0.7,
    geneticScore: 0.9,
  };
  const strongMechanism = {
    chemblId: "CHEMBL25",
    maxPhase: 4,
    mechanismOfAction: "inhibitor",
    hasTargetBioactivity: true,
  };
  const oneGoodTrial = {
    trials: [
      { nctId: "NCT1", title: "t", phase: "PHASE2", overallStatus: "RECRUITING", failed: false },
    ],
    count: 1,
    hasFailedTrial: false,
  };
  const noSafety = { assessed: true, prr: 1.1, ic025: -0.3, signal: false };

  it("STRONG when target associates + mechanism known + a non-failed trial", () => {
    const r = scoreRepurposing({
      sharedTargets: strongTargets,
      mechanism: strongMechanism,
      existingTrials: oneGoodTrial,
      safety: noSafety,
    });
    // 0.45*0.9 + 0.30*(1.0+0.15 capped at 1.0) + 0.25*1 = 0.405 + 0.30 + 0.25 = 0.955
    expect(r.score).toBeCloseTo(0.955, 3);
    expect(r.verdict).toBe("strong_rationale");
  });

  it("DISCOURAGED override when an existing trial has failed, despite strong signals", () => {
    const r = scoreRepurposing({
      sharedTargets: strongTargets,
      mechanism: strongMechanism,
      existingTrials: {
        trials: [
          { nctId: "NCT1", title: "t", phase: "PHASE3", overallStatus: "TERMINATED", failed: true },
        ],
        count: 1,
        hasFailedTrial: true,
      },
      safety: noSafety,
    });
    expect(r.verdict).toBe("discouraged");
    expect(r.rationale).toMatch(/terminated|negative/i);
  });

  it("DISCOURAGED override when FAERS fires a safety signal, despite strong signals", () => {
    const r = scoreRepurposing({
      sharedTargets: strongTargets,
      mechanism: strongMechanism,
      existingTrials: oneGoodTrial,
      safety: { assessed: true, prr: 6.2, ic025: 1.1, signal: true },
    });
    expect(r.verdict).toBe("discouraged");
    expect(r.rationale).toMatch(/disproportionate/i);
  });

  it("WEAK when nothing but a null genetic score and no trials/mechanism", () => {
    const r = scoreRepurposing({
      sharedTargets: { targetSymbol: null, associationFound: false, overallScore: null, geneticScore: null },
      mechanism: { chemblId: null, maxPhase: null, mechanismOfAction: null, hasTargetBioactivity: false },
      existingTrials: { trials: [], count: 0, hasFailedTrial: false },
      safety: { assessed: false, prr: null, ic025: null, signal: false },
    });
    expect(r.score).toBe(0);
    expect(r.verdict).toBe("weak");
  });

  it("PLAUSIBLE in the middle band (genetic support only, no advancement/trials)", () => {
    const r = scoreRepurposing({
      sharedTargets: { targetSymbol: "T", associationFound: true, overallScore: 0.5, geneticScore: 0.8 },
      mechanism: { chemblId: null, maxPhase: null, mechanismOfAction: null, hasTargetBioactivity: false },
      existingTrials: { trials: [], count: 0, hasFailedTrial: false },
      safety: { assessed: true, prr: 1, ic025: -1, signal: false },
    });
    // 0.45*0.8 = 0.36 -> in [0.3, 0.6)
    expect(r.score).toBeCloseTo(0.36, 3);
    expect(r.verdict).toBe("plausible");
  });

  it("a failed trial does NOT contribute positively to the trials channel", () => {
    const withFailed = scoreRepurposing({
      sharedTargets: { targetSymbol: "T", associationFound: false, overallScore: null, geneticScore: null },
      mechanism: { chemblId: null, maxPhase: null, mechanismOfAction: null, hasTargetBioactivity: false },
      existingTrials: {
        trials: [{ nctId: "NCT1", title: "t", phase: null, overallStatus: "WITHDRAWN", failed: true }],
        count: 1,
        hasFailedTrial: true,
      },
      safety: { assessed: false, prr: null, ic025: null, signal: false },
    });
    // Score has no positive channels; only the discouraged override applies.
    expect(withFailed.score).toBe(0);
    expect(withFailed.verdict).toBe("discouraged");
  });
});

describe("assembleRepurposingEvidence — composition over mocked engines", () => {
  it("assembles a STRONG bundle and matches the schema", async () => {
    const deps = makeDeps({
      target: targetEvidence({ datatypeScores: { genetic_association: 0.9, known_drug: null, literature: null, animal_model: null } }),
      chembl: chembl(),
      trials: [trial({ overallStatus: "RECRUITING" } as never)],
      safety: safety({ signal: false }),
    });

    const ev = await assembleRepurposingEvidence({ drug: "DrugX", indication: "DiseaseY" }, deps);

    expect(() => RepurposingEvidenceSchema.parse(ev)).not.toThrow();
    expect(ev.verdict).toBe("strong_rationale");
    expect(ev.sharedTargets.geneticScore).toBe(0.9);
    expect(ev.mechanism.maxPhase).toBe(4);
    expect(ev.existingTrials.hasFailedTrial).toBe(false);
    expect(ev.score).toBeGreaterThanOrEqual(0.6);
  });

  it("marks a TERMINATED trial as failed and returns discouraged", async () => {
    const deps = makeDeps({
      chembl: chembl(),
      trials: [trial({ overallStatus: "TERMINATED", nctId: "NCT9" } as never)],
      safety: safety({ signal: false }),
    });

    const ev = await assembleRepurposingEvidence({ drug: "DrugX", indication: "DiseaseY" }, deps);

    expect(ev.existingTrials.hasFailedTrial).toBe(true);
    expect(ev.existingTrials.trials[0].failed).toBe(true);
    expect(ev.verdict).toBe("discouraged");
  });

  it("degrades honestly when ChEMBL returns null (no fabricated phase)", async () => {
    const deps = makeDeps({
      chembl: null, // ChEMBL failure
      trials: [],
      safety: null,
    });

    const ev = await assembleRepurposingEvidence({ drug: "Unknown", indication: "DiseaseY" }, deps);

    expect(ev.mechanism.chemblId).toBeNull();
    expect(ev.mechanism.maxPhase).toBeNull();
    // No target symbol from ChEMBL -> no shared-target association is even attempted.
    expect(ev.sharedTargets.associationFound).toBe(false);
    expect(ev.sharedTargets.geneticScore).toBeNull();
    // With no positive signals and no override, the verdict is weak.
    expect(ev.verdict).toBe("weak");
  });

  it("does not attempt Open Targets when ChEMBL yields no target symbol", async () => {
    const deps = makeDeps({
      chembl: chembl({ targetSymbol: null }),
      trials: [],
      safety: null,
    });

    await assembleRepurposingEvidence({ drug: "DrugX", indication: "DiseaseY" }, deps);

    expect(deps.targetDiseaseEvidence).not.toHaveBeenCalled();
  });

  it("survives an Open Targets throw with an honest empty shared-target signal", async () => {
    const deps = makeDeps({
      targetThrows: true,
      chembl: chembl({ targetSymbol: "T" }),
      trials: [],
      safety: null,
    });

    const ev = await assembleRepurposingEvidence({ drug: "DrugX", indication: "DiseaseY" }, deps);

    expect(ev.sharedTargets.associationFound).toBe(false);
    expect(ev.sharedTargets.geneticScore).toBeNull();
  });

  it("fires the discouraged override on a FAERS safety signal", async () => {
    const deps = makeDeps({
      target: targetEvidence(),
      chembl: chembl(),
      trials: [trial({ overallStatus: "COMPLETED" } as never)],
      safety: safety({ signal: true, prr: 6.5, ic025: 1.2 }),
    });

    const ev = await assembleRepurposingEvidence({ drug: "DrugX", indication: "DiseaseY" }, deps);

    expect(ev.safety.signal).toBe(true);
    expect(ev.verdict).toBe("discouraged");
  });
});

describe("summarizeRepurposing — optional Claude layer references only assembled data", () => {
  it("passes the deterministic score/verdict to the model and validates the JSON", async () => {
    const deps = makeDeps({ chembl: chembl(), trials: [trial({ overallStatus: "RECRUITING" } as never)] });
    const ev = await assembleRepurposingEvidence({ drug: "DrugX", indication: "DiseaseY" }, deps);

    const callJson = vi.fn(async (params: { user: string; schema: { parse: (v: unknown) => unknown } }) => {
      // The prompt must carry the deterministic verdict + score verbatim.
      expect(params.user).toContain(ev.verdict);
      expect(params.user).toContain(ev.score.toFixed(3));
      return params.schema.parse({
        summary: "Strong repurposing rationale driven by genetic target support.",
        keyDriver: "shared_target",
      });
    });

    const summary = await summarizeRepurposing(ev, callJson as never);
    expect(callJson).toHaveBeenCalledTimes(1);
    expect(summary.keyDriver).toBe("shared_target");
  });

  it("rejects a model summary that invents a keyDriver outside the allowed set", async () => {
    const deps = makeDeps({ chembl: chembl() });
    const ev = await assembleRepurposingEvidence({ drug: "DrugX", indication: "DiseaseY" }, deps);

    const callJson = vi.fn(async (params: { schema: { parse: (v: unknown) => unknown } }) =>
      params.schema.parse({ summary: "bad", keyDriver: "astrology" })
    );

    await expect(summarizeRepurposing(ev, callJson as never)).rejects.toThrow();
  });
});
