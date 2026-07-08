// Offline fixtures mode. When MOCK_MODE=true, /api/verify answers the locked demo
// claims from hand-verified fixtures WITHOUT touching Postgres, Claude, or Voyage —
// so the app runs, renders, and demos with zero secrets, and the live demo can't
// stall on API latency. This is NOT a shortcut around correctness: every source_span
// below is a verbatim substring of the cached abstract text, and we run the REAL
// grounding (lib/grounding.ts) + effect-size (lib/effectSize.ts) code on it, exactly
// as the live path does. Only retrieval + the LLM verdict are stubbed. All numbers are
// taken verbatim from the real abstracts (see tests/fixtures/demo-claims.json).

import { VerificationResult } from "./schemas";
import { groundVerificationResult } from "./grounding";
import { reconcile } from "./effectSize";

interface MockSource {
  title: string;
  url: string;
  source_type: "pubmed" | "clinicaltrials";
  external_id: string;
  phase: string | null;
  enrollment_count: number | null;
  raw_text: string;
}

interface MockEntry {
  match: (claim: string) => boolean;
  source: MockSource;
  finding: Record<string, unknown>;
  raw: VerificationResult; // pre-LLM verdict; grounded for real below
}

const LECANEMAB_TEXT =
  "The adjusted least-squares mean change from baseline at 18 months was 1.21 with " +
  "lecanemab and 1.66 with placebo (difference, -0.45; 95% confidence interval [CI], " +
  "-0.67 to -0.23; P<0.001). Lecanemab resulted in infusion-related reactions in 26.4% " +
  "of the participants and amyloid-related imaging abnormalities with edema or effusions " +
  "in 12.6%. Lecanemab reduced markers of amyloid in early Alzheimer's disease and " +
  "resulted in moderately less decline on measures of cognition and function than " +
  "placebo at 18 months but was associated with adverse events.";

const SPRINT_TEXT =
  "We randomly assigned 9361 persons with a systolic blood pressure of 130 mm Hg or " +
  "higher and an increased cardiovascular risk, but without diabetes, to a systolic " +
  "blood-pressure target of less than 120 mm Hg (intensive treatment) or a target of " +
  "less than 140 mm Hg (standard treatment). The intervention was stopped early after a " +
  "median follow-up of 3.26 years owing to a significantly lower rate of the primary " +
  "composite outcome in the intensive-treatment group than in the standard-treatment " +
  "group (1.65% per year vs. 2.19% per year; hazard ratio with intensive treatment, " +
  "0.75; 95% confidence interval [CI], 0.64 to 0.89; P<0.001). The primary composite " +
  "outcome was myocardial infarction, other acute coronary syndromes, stroke, heart " +
  "failure, or death from cardiovascular causes.";

const ENTRIES: MockEntry[] = [
  {
    match: (c) => c.includes("lecanemab"),
    source: {
      title: "Lecanemab in Early Alzheimer's Disease",
      url: "https://pubmed.ncbi.nlm.nih.gov/36449413/",
      source_type: "pubmed",
      external_id: "36449413",
      phase: null,
      enrollment_count: null,
      raw_text: LECANEMAB_TEXT,
    },
    finding: {
      effect_size: "CDR-SB difference of -0.45 points at 18 months (95% CI -0.67 to -0.23)",
      population: "early Alzheimer's disease with amyloid on PET",
      condition: "early Alzheimer's disease",
      endpoint: "change from baseline in CDR-SB at 18 months",
      caveats: [
        "ARIA-E (edema or effusions) in 12.6% of the lecanemab group",
        "infusion-related reactions in 26.4%",
      ],
    },
    raw: {
      discrepancy_type: "magnitude_overstated",
      trust_score: 34,
      explanation:
        "The abstract reports the primary result as a CDR-SB difference of -0.45 points, not a '27% slowing', and gives the ARIA-E (edema) rate as 12.6% — the claim's 21.3% figure is the combined any-ARIA rate and is not the edema rate.",
      flagged_spans: [
        {
          claim_span: "slowed cognitive decline by 27%",
          source_span: "difference, -0.45",
          issue:
            "The source states an absolute CDR-SB difference of -0.45 points; '27%' is a derived relative figure not stated in the abstract.",
        },
        {
          claim_span: "ARIA-E edema) in 21.3%",
          source_span: "amyloid-related imaging abnormalities with edema or effusions in 12.6%",
          issue: "The source's ARIA-E (edema) rate is 12.6%, not 21.3%.",
        },
      ],
      cross_source_agreement: "single_source",
    },
  },
  {
    match: (c) =>
      c.includes("sprint") ||
      c.includes("blood pressure") ||
      c.includes("blood-pressure") ||
      c.includes("intensive"),
    source: {
      title: "A Randomized Trial of Intensive versus Standard Blood-Pressure Control (SPRINT)",
      url: "https://pubmed.ncbi.nlm.nih.gov/26551272/",
      source_type: "pubmed",
      external_id: "26551272",
      phase: null,
      enrollment_count: null,
      raw_text: SPRINT_TEXT,
    },
    finding: {
      effect_size: "hazard ratio 0.75 (95% CI 0.64 to 0.89) for the primary composite outcome",
      population: "adults with SBP >=130 mm Hg at increased cardiovascular risk, without diabetes",
      condition: "hypertension with elevated cardiovascular risk",
      endpoint: "primary composite cardiovascular outcome",
      caveats: ["intervention stopped early at median 3.26 years"],
    },
    raw: {
      discrepancy_type: "accurate",
      trust_score: 95,
      explanation:
        "The claim matches the source: intensive control to <120 vs <140 mm Hg in non-diabetic adults at increased CV risk reduced the primary composite outcome with a hazard ratio of 0.75.",
      flagged_spans: [],
      cross_source_agreement: "single_source",
    },
  },
];

export interface MockVerifyResponse {
  status: "verified" | "no_support_found";
  message?: string;
  verification_id: string | null;
  claim: string;
  mock: true;
  source?: unknown;
  corroborating_sources?: unknown[];
  cross_source_agreement?: string;
  finding?: unknown;
  verification?: unknown;
  effect_size_check?: unknown;
}

/**
 * Build a realistic /api/verify response for a demo claim using only fixtures +
 * the real grounding/effect-size code. Returns null if the claim isn't a known
 * demo claim (the route then answers no_support_found in mock mode).
 */
export function getMockVerifyResponse(claim: string): MockVerifyResponse | null {
  const c = claim.toLowerCase();

  // Honest abstention: the dapagliflozin claim cites the wrong trial.
  if (c.includes("dapagliflozin")) {
    return {
      status: "no_support_found",
      verification_id: null,
      claim,
      mock: true,
      message:
        "Couldn't find a confident matching primary source. The cited trial studies a different intervention (blood-pressure targets, not dapagliflozin) and a different population, so PaperTrail abstains rather than forcing a match on a coincidental hazard ratio.",
    };
  }

  const entry = ENTRIES.find((e) => e.match(c));
  if (!entry) return null;

  // Run the REAL grounding + effect-size code on the fixture — same as the live path.
  const verification = groundVerificationResult(entry.raw, entry.source.raw_text);
  const effect_size_check = reconcile(claim, entry.source.raw_text);

  return {
    status: "verified",
    verification_id: null,
    claim,
    mock: true,
    source: {
      title: entry.source.title,
      url: entry.source.url,
      source_type: entry.source.source_type,
      external_id: entry.source.external_id,
      phase: entry.source.phase,
      enrollment_count: entry.source.enrollment_count,
      raw_text: entry.source.raw_text,
    },
    corroborating_sources: [],
    cross_source_agreement: verification.cross_source_agreement,
    finding: entry.finding,
    verification,
    effect_size_check,
  };
}
