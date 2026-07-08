// ClinicalTrials.gov API v2 client. No key required.
// Docs: https://clinicaltrials.gov/data-api/api

const CTGOV_BASE = "https://clinicaltrials.gov/api/v2/studies";

// Raw per-arm outcome numbers from the registry (event count + denominator), which
// let us recompute absolute risk deterministically rather than trust a stated %.
export interface TrialGroupResult {
  groupTitle: string;
  eventCount: number | null;
  denominator: number | null;
  riskPercent: number | null; // eventCount / denominator * 100
}

// A single registered statistical analysis from a trial's results section — the
// machine-readable, sponsor-reported effect estimate. This is ground truth we can
// verify a claim against deterministically, no LLM in the numeric loop.
export interface TrialResultAnalysis {
  outcomeTitle: string;
  outcomeType: string | null; // "PRIMARY" | "SECONDARY" | "OTHER_PRE_SPECIFIED" ...
  paramType: string | null; // e.g. "Hazard Ratio (HR)", "Odds Ratio (OR)", "Risk Ratio (RR)"
  paramValue: number | null;
  ciPct: number | null; // e.g. 95
  ciLower: number | null;
  ciUpper: number | null;
  pValue: string | null; // kept as string: registries store "<0.001", "0.03", etc.
  method: string | null;
  // Raw-count-derived stats for this analysis's outcome (when arm-level counts exist).
  groupResults?: TrialGroupResult[];
  absoluteRiskReduction?: number | null; // percentage points, from raw counts
  numberNeededToTreat?: number | null;
  computedRRR?: number | null; // relative risk reduction (%) recomputed from raw counts
}

function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Pull the arm-level event counts + denominators for a binary outcome measure and
// derive ARR / NNT / recomputed RRR. Handles the common 2-arm binary-count layout;
// returns empty/nulls when the structure isn't a simple count (e.g. time-to-event only).
function extractRawStats(outcome: any): {
  groupResults: TrialGroupResult[];
  arr: number | null;
  nnt: number | null;
  computedRRR: number | null;
} {
  const groups: Array<{ id: string; title: string }> = (outcome?.groups ?? []).map((g: any) => ({
    id: g?.id ?? "",
    title: g?.title ?? "",
  }));

  const denomCounts: Record<string, number | null> = {};
  for (const d of outcome?.denoms ?? []) {
    for (const c of d?.counts ?? []) denomCounts[c?.groupId] = toNum(c?.value);
  }

  // First class -> first category -> measurements per group (the binary event counts).
  const firstCategory = outcome?.classes?.[0]?.categories?.[0];
  const eventCounts: Record<string, number | null> = {};
  for (const m of firstCategory?.measurements ?? []) eventCounts[m?.groupId] = toNum(m?.value);

  const groupResults: TrialGroupResult[] = groups.map((g) => {
    const eventCount = eventCounts[g.id] ?? null;
    const denominator = denomCounts[g.id] ?? null;
    const riskPercent =
      eventCount !== null && denominator && denominator > 0 ? (eventCount / denominator) * 100 : null;
    return { groupTitle: g.title, eventCount, denominator, riskPercent };
  });

  const risks = groupResults.map((g) => g.riskPercent).filter((r): r is number => r !== null);
  if (risks.length !== 2) return { groupResults, arr: null, nnt: null, computedRRR: null };

  const high = Math.max(risks[0], risks[1]);
  const low = Math.min(risks[0], risks[1]);
  const arr = high - low; // percentage points
  const computedRRR = high > 0 ? (arr / high) * 100 : null;
  const nnt = arr > 0 ? 100 / arr : null; // risks are in %, so 100/arr participants
  return { groupResults, arr, nnt, computedRRR };
}

/**
 * Fetch a trial's REGISTERED statistical results (primary/secondary outcome analyses)
 * from the structured resultsSection — not the free-text description. Returns [] when
 * the study has no posted results. Ordered primary-first.
 */
export async function fetchTrialResults(nctId: string): Promise<TrialResultAnalysis[]> {
  const res = await fetch(`${CTGOV_BASE}/${encodeURIComponent(nctId)}?format=json`);
  if (!res.ok) return [];
  const data = await res.json();

  const outcomes =
    data?.resultsSection?.outcomeMeasuresModule?.outcomeMeasures ?? [];
  const analyses: TrialResultAnalysis[] = [];

  for (const outcome of outcomes) {
    const outcomeTitle: string = outcome?.title ?? "";
    const outcomeType: string | null = outcome?.type ?? null;
    const raw = extractRawStats(outcome);
    for (const a of outcome?.analyses ?? []) {
      analyses.push({
        outcomeTitle,
        outcomeType,
        paramType: a?.paramType ?? null,
        paramValue: toNum(a?.paramValue),
        ciPct: toNum(a?.ciPctValue),
        ciLower: toNum(a?.ciLowerLimit),
        ciUpper: toNum(a?.ciUpperLimit),
        pValue: a?.pValue != null ? String(a.pValue) : null,
        method: a?.statisticalMethod ?? null,
        groupResults: raw.groupResults.length > 0 ? raw.groupResults : undefined,
        absoluteRiskReduction: raw.arr,
        numberNeededToTreat: raw.nnt,
        computedRRR: raw.computedRRR,
      });
    }
  }

  // Primary outcomes first — that's what a claim usually references.
  return analyses.sort((x, y) => {
    const px = x.outcomeType === "PRIMARY" ? 0 : 1;
    const py = y.outcomeType === "PRIMARY" ? 0 : 1;
    return px - py;
  });
}

export interface TrialRecord {
  nctId: string;
  title: string;
  summaryText: string;
  url: string;
  // Structured trial context straight from the API's designModule (not LLM-inferred).
  phase: string | null;
  enrollmentCount: number | null;
}

/** Search ClinicalTrials.gov for studies matching a free-text query. */
export async function searchTrials(query: string, pageSize = 5): Promise<TrialRecord[]> {
  const params = new URLSearchParams({
    "query.term": query,
    pageSize: String(pageSize),
    format: "json",
    fields: [
      "NCTId",
      "BriefTitle",
      "BriefSummary",
      "DetailedDescription",
      "PrimaryOutcomeMeasure",
      "EligibilityCriteria",
      "ResultsFirstPostDate",
      "Phase",
      "EnrollmentCount",
    ].join(","),
  });

  const res = await fetch(`${CTGOV_BASE}?${params}`);
  if (!res.ok) throw new Error(`ClinicalTrials.gov search failed: ${res.status}`);
  const data = await res.json();

  const studies = data?.studies ?? [];
  return studies.map((s: any): TrialRecord => {
    const proto = s?.protocolSection ?? {};
    const idModule = proto.identificationModule ?? {};
    const descModule = proto.descriptionModule ?? {};
    const outcomesModule = proto.outcomesModule ?? {};
    const eligModule = proto.eligibilityModule ?? {};
    const designModule = proto.designModule ?? {};

    const nctId = idModule.nctId ?? "unknown";
    const title = idModule.briefTitle ?? "";
    const summary = descModule.briefSummary ?? "";
    const detail = descModule.detailedDescription ?? "";
    const primaryOutcomes = (outcomesModule.primaryOutcomes ?? [])
      .map((o: any) => o?.measure)
      .filter(Boolean)
      .join("; ");
    const eligibility = eligModule.eligibilityCriteria ?? "";

    // Structured design fields — phases is an array like ["PHASE3"]; enrollmentInfo.count is a number.
    const phases: string[] = Array.isArray(designModule.phases) ? designModule.phases : [];
    const phase = phases.length > 0 ? phases.join("/") : null;
    const rawCount = designModule.enrollmentInfo?.count;
    const enrollmentCount = typeof rawCount === "number" ? rawCount : null;

    const summaryText = [
      title,
      summary,
      detail,
      primaryOutcomes ? `Primary outcome: ${primaryOutcomes}` : "",
      eligibility ? `Eligibility: ${eligibility}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    return {
      nctId,
      title,
      summaryText,
      url: `https://clinicaltrials.gov/study/${nctId}`,
      phase,
      enrollmentCount,
    };
  });
}
