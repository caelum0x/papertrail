import { describe, it, expect, vi } from "vitest";
import {
  interactionSignal,
  classifyInteraction,
  type DdiDeps,
} from "../lib/bio/ddi";
import { disproportionality } from "../lib/bio/pharmacovigilance";
import { InteractionSignalSchema } from "../lib/bio/ddi.schemas";

// These tests exercise the open DDI layer over a MOCKED openFDA fetcher — no live
// network. The contract under test:
//   1. The combined (BOTH-drugs) 2x2 is assembled from FAERS report totals and
//      its disproportionality matches the standalone pharmacovigilance math.
//   2. The synergy contrast fires ONLY when the combined IC is materially higher
//      than the larger single-drug IC (and the combined signal is itself
//      significant) -> synergistic_signal; otherwise no_excess.
//   3. Sparse combined co-reports -> insufficient_data (never a confident guess).
//   4. Any un-assemblable table degrades to an honest null block, never fabricated.

const DRUG_A = "warfarin";
const DRUG_B = "fluconazole";
const EVENT = "haemorrhage";

const DRUG_FIELD = "patient.drug.openfda.generic_name";
const EVENT_FIELD = "patient.reaction.reactionmeddrapt";

// A mocked openFDA totals endpoint. Each of our four count queries per index
// table is a `/drug/event.json?search=...&limit=1`, and we route on the decoded
// `search` string. `counts` maps a logical query key to the total we return.
//
// Query keys:
//   "corpus"          -> total reports carrying any reaction (n denominator)
//   "event"           -> reports mentioning the event               (a+c)
//   "<clause>"        -> reports matching an index clause            (a+b)
//   "<clause>+event"  -> reports matching index clause AND the event (a)
interface CountConfig {
  corpus: number;
  event: number;
  // Per index clause: its own total and its co-count with the event.
  index: Record<string, { total: number; withEvent: number }>;
}

// Build the exact index clause strings the engine constructs, so the router can
// key on them without re-deriving openFDA quoting rules in the test.
function drugClause(name: string): string {
  return `${DRUG_FIELD}:"${name}"`;
}
function eventClause(name: string): string {
  return `${EVENT_FIELD}:"${name}"`;
}
function bothClause(a: string, b: string): string {
  return `${drugClause(a)} AND ${drugClause(b)}`;
}

function makeFetch(config: CountConfig): DdiDeps["fetchJson"] {
  const evClause = eventClause(EVENT);
  return vi.fn(async (url: string) => {
    const search = new URL(url).searchParams.get("search") ?? "";
    const total = (t: number) => ({ meta: { results: { total: t } } });

    // Corpus denominator.
    if (search.includes("_exists_:patient.reaction.reactionmeddrapt")) {
      return total(config.corpus);
    }

    // Is this an index-clause AND event co-count? It contains " AND <event>".
    const withEventSuffix = ` AND ${evClause}`;
    if (search.endsWith(withEventSuffix)) {
      const indexPart = search.slice(0, -withEventSuffix.length);
      const entry = config.index[indexPart];
      if (entry) return total(entry.withEvent);
      throw new Error(`no mock for index+event: ${indexPart}`);
    }

    // A bare event count (a+c).
    if (search === evClause) {
      return total(config.event);
    }

    // Otherwise it's a bare index-clause total (a+b).
    const entry = config.index[search];
    if (entry) return total(entry.total);

    throw new Error(`no mock for search: ${search}`);
  });
}

describe("classifyInteraction — deterministic contrast", () => {
  // Strong combined signal, weak single-drug signals -> synergy.
  const strongCombined = disproportionality({ a: 40, b: 60, c: 200, d: 200000 })!;
  const weakA = disproportionality({ a: 30, b: 3000, c: 300, d: 200000 })!;
  const weakB = disproportionality({ a: 25, b: 2500, c: 300, d: 200000 })!;

  it("flags synergistic_signal when combined IC is materially above both singles", () => {
    expect(strongCombined.informationComponent).toBeGreaterThan(
      Math.max(weakA.informationComponent, weakB.informationComponent) + 0.5
    );
    expect(strongCombined.ic025).toBeGreaterThan(0);
    expect(classifyInteraction(strongCombined, weakA, weakB)).toBe(
      "synergistic_signal"
    );
  });

  it("returns no_excess when the combined signal is explained by a single drug", () => {
    // drugA alone already has as strong a signal as the combination.
    const strongA = disproportionality({ a: 40, b: 60, c: 200, d: 200000 })!;
    expect(classifyInteraction(strongCombined, strongA, weakB)).toBe("no_excess");
  });

  it("returns insufficient_data when combined co-reports are below the gate", () => {
    const sparse = disproportionality({ a: 2, b: 10, c: 50, d: 100000 })!;
    expect(classifyInteraction(sparse, weakA, weakB)).toBe("insufficient_data");
  });

  it("returns insufficient_data when the combined block is missing entirely", () => {
    expect(classifyInteraction(null, weakA, weakB)).toBe("insufficient_data");
  });

  it("treats a missing single-drug block as no single-drug explanation (-Inf baseline)", () => {
    // With both singles absent, any significant combined signal is synergy.
    expect(strongCombined.ic025).toBeGreaterThan(0);
    expect(classifyInteraction(strongCombined, null, null)).toBe(
      "synergistic_signal"
    );
  });
});

describe("interactionSignal — combined 2x2 matches standalone disproportionality", () => {
  it("assembles the BOTH-drug 2x2 from FAERS totals and computes it correctly", async () => {
    // Combined index (both drugs): total a+b = 100, with event a = 40.
    // corpus n = 200240, event a+c = 240 -> c = 200, d = n-a-b-c = 200000.
    const config: CountConfig = {
      corpus: 200240,
      event: 240,
      index: {
        [bothClause(DRUG_A, DRUG_B)]: { total: 100, withEvent: 40 },
        [drugClause(DRUG_A)]: { total: 3030, withEvent: 30 },
        [drugClause(DRUG_B)]: { total: 2525, withEvent: 25 },
      },
    };

    const result = await interactionSignal(
      { drugA: DRUG_A, drugB: DRUG_B, event: EVENT },
      { fetchJson: makeFetch(config) }
    );

    expect(() => InteractionSignalSchema.parse(result)).not.toThrow();

    // The combined block must equal disproportionality on the derived 2x2.
    // Derived cells: a=40, b=100-40=60, c=240-40=200, d=200240-40-60-200=199940.
    const expected = disproportionality({ a: 40, b: 60, c: 200, d: 199940 })!;
    expect(result.combined).not.toBeNull();
    expect(result.combined!.a).toBe(40);
    expect(result.combined!.b).toBe(60);
    expect(result.combined!.c).toBe(200);
    expect(result.combined!.d).toBe(199940);
    expect(result.combined!.prr).toBeCloseTo(expected.prr, 6);
    expect(result.combined!.ror).toBeCloseTo(expected.ror, 6);
    expect(result.combined!.informationComponent).toBeCloseTo(
      expected.informationComponent,
      6
    );

    // Single-drug blocks are assembled independently and populated.
    expect(result.aAlone).not.toBeNull();
    expect(result.bAlone).not.toBeNull();
    expect(result.aAlone!.a).toBe(30);
    expect(result.bAlone!.a).toBe(25);
  });

  it("flags synergistic_signal end-to-end when combination exceeds both singles", async () => {
    const config: CountConfig = {
      corpus: 200240,
      event: 240,
      index: {
        // Combined: strong (40/100 reports are the event).
        [bothClause(DRUG_A, DRUG_B)]: { total: 100, withEvent: 40 },
        // Each drug alone: weak (event is a tiny fraction of its reports).
        [drugClause(DRUG_A)]: { total: 3030, withEvent: 30 },
        [drugClause(DRUG_B)]: { total: 2525, withEvent: 25 },
      },
    };

    const result = await interactionSignal(
      { drugA: DRUG_A, drugB: DRUG_B, event: EVENT },
      { fetchJson: makeFetch(config) }
    );

    const singleMax = Math.max(
      result.aAlone!.informationComponent,
      result.bAlone!.informationComponent
    );
    expect(result.combined!.informationComponent).toBeGreaterThan(singleMax + 0.5);
    expect(result.interaction).toBe("synergistic_signal");
  });

  it("returns no_excess when the combined signal is no stronger than a single drug", async () => {
    const config: CountConfig = {
      corpus: 200240,
      event: 240,
      index: {
        // Combined and drugA are equally strong -> combination adds nothing.
        [bothClause(DRUG_A, DRUG_B)]: { total: 100, withEvent: 40 },
        [drugClause(DRUG_A)]: { total: 100, withEvent: 40 },
        [drugClause(DRUG_B)]: { total: 2525, withEvent: 25 },
      },
    };

    const result = await interactionSignal(
      { drugA: DRUG_A, drugB: DRUG_B, event: EVENT },
      { fetchJson: makeFetch(config) }
    );

    expect(result.interaction).toBe("no_excess");
  });

  it("returns insufficient_data on sparse combined co-reports", async () => {
    const config: CountConfig = {
      corpus: 200240,
      event: 240,
      index: {
        // Only 2 co-reports of BOTH drugs + event -> below the a>=3 gate.
        [bothClause(DRUG_A, DRUG_B)]: { total: 20, withEvent: 2 },
        [drugClause(DRUG_A)]: { total: 3030, withEvent: 30 },
        [drugClause(DRUG_B)]: { total: 2525, withEvent: 25 },
      },
    };

    const result = await interactionSignal(
      { drugA: DRUG_A, drugB: DRUG_B, event: EVENT },
      { fetchJson: makeFetch(config) }
    );

    expect(result.combined).not.toBeNull();
    expect(result.combined!.a).toBe(2);
    expect(result.interaction).toBe("insufficient_data");
  });
});

describe("interactionSignal — honest empty on failure", () => {
  it("returns null blocks (never fabricated) when the fetcher throws for a table", async () => {
    // Fetcher throws for everything -> every table un-assemblable.
    const fetchJson = vi.fn(async () => {
      throw new Error("openFDA down");
    });

    const result = await interactionSignal(
      { drugA: DRUG_A, drugB: DRUG_B, event: EVENT },
      { fetchJson }
    );

    expect(result.combined).toBeNull();
    expect(result.aAlone).toBeNull();
    expect(result.bAlone).toBeNull();
    expect(result.interaction).toBe("insufficient_data");
  });

  it("refuses to build a 2x2 with a negative derived cell (inconsistent totals)", async () => {
    // event total (a+c) smaller than the co-count a -> c would be negative.
    const config: CountConfig = {
      corpus: 200240,
      event: 10, // a+c = 10 but combined withEvent a = 40 -> c < 0
      index: {
        [bothClause(DRUG_A, DRUG_B)]: { total: 100, withEvent: 40 },
        [drugClause(DRUG_A)]: { total: 3030, withEvent: 30 },
        [drugClause(DRUG_B)]: { total: 2525, withEvent: 25 },
      },
    };

    const result = await interactionSignal(
      { drugA: DRUG_A, drugB: DRUG_B, event: EVENT },
      { fetchJson: makeFetch(config) }
    );

    // The inconsistent combined table is refused (null), so the verdict falls
    // back to insufficient_data rather than a fabricated signal.
    expect(result.combined).toBeNull();
    expect(result.interaction).toBe("insufficient_data");
  });

  it("returns an honest empty result for blank inputs without any fetch", async () => {
    const fetchJson = vi.fn(async () => ({ meta: { results: { total: 0 } } }));
    const result = await interactionSignal(
      { drugA: "", drugB: DRUG_B, event: EVENT },
      { fetchJson }
    );

    expect(fetchJson).not.toHaveBeenCalled();
    expect(result.combined).toBeNull();
    expect(result.interaction).toBe("insufficient_data");
  });
});
