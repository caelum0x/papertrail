// Static catalog of PaperTrail's public MCP tools, mirrored 1:1 from the local
// stdio MCP package (mcp/src/tools/*.ts) but declared as plain JSON Schema so the
// hosted Streamable-HTTP MCP server (app/api/mcp/route.ts) can serve them without
// pulling in the zod-based mcp/ package.
//
// SOURCE OF TRUTH is mcp/src/tools: verification.ts, synthesis.ts (+
// synthesis.shared.ts), biomedical.ts (+ biomedicalCore.ts, biomedicalExtra.ts),
// research.ts. Every public tool there is reproduced here with the SAME snake_case
// name, description, HTTP method, target /api path, and an inputSchema translated
// field-for-field from the corresponding zod schema. Field names are EXACT so the
// dispatcher can forward them straight into each app route's request body.
//
// The two orgScoped API-key tools are intentionally omitted: the hosted endpoint
// is public/unauthenticated, so only read-only, key-free tools are exposed.
//
// Three tools whose app route reads a `?summarize=true` query param
// (bio_target_disease, bio_repurposing, bio_biomarker) record `queryKeys` so the
// dispatcher lifts those args out of the JSON body and onto the query string; all
// other tools POST a JSON body with no query params.

// A JSON Schema object node. Kept intentionally loose (Record<string, unknown>)
// because it is passed straight through to the MCP client as an opaque schema.
export type JsonSchema = Record<string, unknown>;

// One hosted MCP tool: its wire name/description, the HTTP call the dispatcher
// makes against our own origin, and the JSON Schema shown to MCP clients.
export interface McpToolDef {
  readonly name: string;
  readonly description: string;
  readonly method: "POST" | "GET";
  readonly path: string;
  readonly inputSchema: JsonSchema;
  // Argument keys that must be moved from the JSON body to the query string
  // (e.g. "summarize"). Omitted when the whole payload is a JSON body.
  readonly queryKeys?: readonly string[];
}

// --- Small JSON-Schema builders (immutable; each returns a fresh object) ------

const str = (extra: JsonSchema = {}): JsonSchema => ({ type: "string", ...extra });
const num = (extra: JsonSchema = {}): JsonSchema => ({ type: "number", ...extra });
const int = (extra: JsonSchema = {}): JsonSchema => ({ type: "integer", ...extra });
const bool = (extra: JsonSchema = {}): JsonSchema => ({ type: "boolean", ...extra });

const obj = (
  properties: Record<string, JsonSchema>,
  required: readonly string[] = []
): JsonSchema => ({
  type: "object",
  properties,
  ...(required.length > 0 ? { required: [...required] } : {}),
  additionalProperties: false,
});

const arr = (items: JsonSchema, extra: JsonSchema = {}): JsonSchema => ({
  type: "array",
  items,
  ...extra,
});

// --- Shared shapes (mirrors of the zod fragments in the mcp/ package) ---------

// meta_crosscheck study input (StudyInputSchema): point+CI OR raw 2x2 counts.
const crosscheckStudy: JsonSchema = obj(
  {
    label: str({
      minLength: 1,
      maxLength: 200,
      description: "A short label for the study, e.g. its first-author + year.",
    }),
    measure: str({
      enum: ["RR", "HR", "OR"],
      description:
        "Ratio effect measure: RR (risk ratio), HR (hazard ratio), or OR (odds ratio).",
    }),
    point: num({
      exclusiveMinimum: 0,
      description:
        "Point estimate of the ratio (e.g. 0.72). Provide with CI, or use the 2x2 counts instead.",
    }),
    ciLower: num({
      exclusiveMinimum: 0,
      description: "Lower bound of the confidence interval for the point estimate.",
    }),
    ciUpper: num({
      exclusiveMinimum: 0,
      description: "Upper bound of the confidence interval for the point estimate.",
    }),
    ciPct: num({
      exclusiveMinimum: 0,
      exclusiveMaximum: 100,
      description: "Confidence-interval width in percent (default 95 if omitted).",
    }),
    events1: num({
      minimum: 0,
      description: "2x2 counts: events in the treatment/exposed arm.",
    }),
    total1: num({
      minimum: 0,
      description: "2x2 counts: total subjects in the treatment/exposed arm.",
    }),
    events2: num({
      minimum: 0,
      description: "2x2 counts: events in the control/unexposed arm.",
    }),
    total2: num({
      minimum: 0,
      description: "2x2 counts: total subjects in the control/unexposed arm.",
    }),
  },
  ["label", "measure"]
);

// A ratio-scale study effect (ratioStudy): point+CI OR 2x2 counts.
const ratioStudy: JsonSchema = obj(
  {
    label: str({ minLength: 1, maxLength: 200, description: "Study label, e.g. 'SPRINT 2015'." }),
    measure: str({
      enum: ["RR", "HR", "OR"],
      description: "Ratio measure: risk ratio, hazard ratio, or odds ratio.",
    }),
    point: num({ exclusiveMinimum: 0, description: "Point estimate on the ratio scale (>0)." }),
    ci_lower: num({ exclusiveMinimum: 0, description: "Lower confidence bound (>0)." }),
    ci_upper: num({ exclusiveMinimum: 0, description: "Upper confidence bound (>0)." }),
    ci_pct: num({ minimum: 50, maximum: 99.9, description: "CI width percent (default 95)." }),
    events1: int({ minimum: 0, description: "Treatment-arm events (2x2 form)." }),
    total1: int({ exclusiveMinimum: 0, description: "Treatment-arm total (2x2 form)." }),
    events2: int({ minimum: 0, description: "Control-arm events (2x2 form)." }),
    total2: int({ exclusiveMinimum: 0, description: "Control-arm total (2x2 form)." }),
  },
  ["label", "measure"]
);

// Ratio study inside a subgroup: same fields, all nullable.
const nullableRatioStudy: JsonSchema = obj(
  {
    label: str({ minLength: 1, maxLength: 200 }),
    measure: str({ enum: ["RR", "HR", "OR"] }),
    point: { type: ["number", "null"], exclusiveMinimum: 0 },
    ci_lower: { type: ["number", "null"], exclusiveMinimum: 0 },
    ci_upper: { type: ["number", "null"], exclusiveMinimum: 0 },
    ci_pct: { type: ["number", "null"], minimum: 50, maximum: 99.99 },
    events1: { type: ["integer", "null"], minimum: 0 },
    total1: { type: ["integer", "null"], minimum: 0 },
    events2: { type: ["integer", "null"], minimum: 0 },
    total2: { type: ["integer", "null"], minimum: 0 },
  },
  ["label", "measure"]
);

// A pre-computed log-effect + variance point (logPointFields).
const logPointProps = {
  label: str({ minLength: 1, maxLength: 200, description: "Point label." }),
  yi: num({ description: "Observed log-effect (e.g. ln(RR))." }),
  vi: num({ exclusiveMinimum: 0, description: "Variance of the log-effect (>0)." }),
} as const;

// A network edge: pre-pooled { log_effect, variance } OR studies to pool.
const networkEdge: JsonSchema = obj({
  log_effect: num({ description: "Pre-pooled log-scale contrast." }),
  variance: num({ exclusiveMinimum: 0, description: "Variance of the pooled log contrast." }),
  studies: arr(ratioStudy, {
    minItems: 1,
    maxItems: 100,
    description: "Studies to pool into this edge instead.",
  }),
});

// --- The catalog --------------------------------------------------------------

export const MCP_TOOLS: readonly McpToolDef[] = [
  // === verification.ts =======================================================
  {
    name: "verify_claim",
    description:
      "Verify a single clinical/efficacy claim (e.g. \"Drug X cut cardiovascular events by 30%\") against the actual " +
      "primary source. PaperTrail retrieves the best-matching PubMed / ClinicalTrials.gov record from its cache, " +
      "extracts the real finding, and reports a discrepancy type, trust score, and the exact flagged spans that map " +
      "back to the source text. Also returns a deterministic effect-size cross-check, a registry check against the " +
      "trial's own registered statistics (for ClinicalTrials.gov sources), and corroborating sources. Use this when " +
      "you have one claim and want to know whether it is faithful to the literature, overstated, or unsupported. " +
      "If no confident source is found it returns an honest 'no_support_found' rather than a forced match.",
    method: "POST",
    path: "/api/verify",
    inputSchema: obj(
      {
        claim: str({
          minLength: 10,
          maxLength: 2000,
          description: "The single efficacy/clinical claim to verify (10-2000 characters).",
        }),
        source_hint: str({
          description:
            "Optional DOI / PMID / NCT id the claim actually cited, to pin verification to that source.",
        }),
      },
      ["claim"]
    ),
  },
  {
    name: "verify_claim_batch",
    description:
      "Verify up to 5 claims in one call. Either paste a block of prose as `text` (PaperTrail splits it into " +
      "individual sentences/claims) or supply an explicit `claims` array. Each claim runs the full verification " +
      "chain and returns its own verdict; the response reports how many were detected and whether the list was " +
      "truncated to the 5-claim cap. Use this to audit an abstract, a press release paragraph, or a slide of " +
      "bullet-point claims in a single pass rather than calling verify_claim repeatedly.",
    method: "POST",
    path: "/api/verify/batch",
    inputSchema: obj({
      text: str({
        description:
          "A passage to split into individual claims. Provide this OR `claims`; if both, `claims` wins.",
      }),
      claims: arr(str(), {
        description: "An explicit list of claims to verify. Only the first 5 are processed.",
      }),
    }),
  },
  {
    name: "verify_text_claims",
    description:
      "Bring-your-own-source verification: check a claim against an arbitrary block of source text you paste " +
      "(an abstract, a results paragraph, an unpublished draft) instead of PaperTrail's retrieval cache. It extracts " +
      "the finding from your text, grounds every flagged span verbatim to it, and runs the deterministic effect-size " +
      "cross-check. Use this when you already know the exact source and want to confirm a claim is faithful to it, " +
      "or when the source is not in any public registry.",
    method: "POST",
    path: "/api/verify/text",
    inputSchema: obj(
      {
        claim: str({ minLength: 10, description: "The claim to verify (at least 10 characters)." }),
        source_text: str({
          minLength: 40,
          maxLength: 20000,
          description:
            "The source text to verify against (40-20000 characters), e.g. an abstract or results passage.",
        }),
      },
      ["claim", "source_text"]
    ),
  },
  {
    name: "meta_crosscheck",
    description:
      "Run a deterministic random-effects meta-analysis over 2+ study-level effects and (when the PyMARE reference " +
      "backend is enabled) cross-check PaperTrail's pooled estimate against an independent reference implementation, " +
      "reporting whether the two agree. No LLM is involved — every number is a closed-form computation. Each study is " +
      "given EITHER a point estimate + confidence interval OR raw 2x2 event counts, with a ratio measure (RR/HR/OR). " +
      "Use this to pool trial results yourself and confirm a published pooled effect is reproducible.",
    method: "POST",
    path: "/api/meta-crosscheck",
    inputSchema: obj(
      {
        studies: arr(crosscheckStudy, {
          minItems: 2,
          maxItems: 200,
          description:
            "At least two studies to pool. Each provides a point+CI or full 2x2 counts, plus its ratio measure.",
        }),
      },
      ["studies"]
    ),
  },
  {
    name: "scientific_claim_eval",
    description:
      "Evaluate a scientific claim in the SciFact / MultiVerS style: assign a SUPPORTS, REFUTES, or NEI (not enough " +
      "info) label and select the rationale sentences from an abstract that justify it. Each rationale is grounded " +
      "back to the abstract verbatim; ungroundable rationales are dropped, and a non-NEI label left with no surviving " +
      "rationale is honestly downgraded to NEI. If you omit `abstract`, PaperTrail retrieves a matching cached source; " +
      "if none is confident it returns 'no_source_found'. Use this for label-style entailment checks against a " +
      "specific abstract, as opposed to the effect-size-aware verify_claim.",
    method: "POST",
    path: "/api/scieval",
    inputSchema: obj(
      {
        claim: str({ description: "The scientific claim to label as SUPPORTS / REFUTES / NEI." }),
        abstract: str({
          description:
            "Optional abstract to evaluate the claim against. If omitted, a matching cached source is retrieved.",
        }),
      },
      ["claim"]
    ),
  },
  {
    name: "fact_check_pipeline",
    description:
      "Run PaperTrail's multi-step fact-verification pipeline (decompose -> checkworthy -> query-gen -> retrieve over " +
      "cached sources -> grounded verify -> aggregate) over a block of natural-language text. It breaks the text into " +
      "atomic claims, filters to the check-worthy ones, verifies each against a real source span, and returns per-claim " +
      "verdicts plus an overall factuality summary. Use this for narrative text (an intro paragraph, a discussion " +
      "section) where claims are embedded in prose and you want an end-to-end factuality report.",
    method: "POST",
    path: "/api/factcheck",
    inputSchema: obj(
      {
        text: str({ description: "The block of natural-language text to decompose and fact-check." }),
      },
      ["text"]
    ),
  },
  {
    name: "fact_check_document",
    description:
      "Supplementary entailment fact-check: given up to 20 (claim, document) pairs, ask PaperTrail's MiniCheck engine " +
      "whether each claim is *supported* (entailed) by its paired document. This complements verbatim-span grounding " +
      "with a natural-language-inference view. When the MiniCheck engine is disabled, the response is an honest " +
      "checked:false rather than fabricated verdicts. Use this when you already have claim/evidence pairs and want a " +
      "fast entailment signal for each.",
    method: "POST",
    path: "/api/fact-check",
    inputSchema: obj(
      {
        pairs: arr(
          obj(
            {
              claim: str({
                maxLength: 2000,
                description: "The claim to test for entailment (max 2000 characters).",
              }),
              doc: str({
                maxLength: 50000,
                description: "The document the claim is checked against (max 50000 characters).",
              }),
            },
            ["claim", "doc"]
          ),
          { minItems: 1, maxItems: 20, description: "1-20 (claim, doc) pairs to entailment-check." }
        ),
      },
      ["pairs"]
    ),
  },
  {
    name: "classify_citation",
    description:
      "Smart-citation classifier (Scite-style). Given a citing passage and a one-sentence summary of the cited work's " +
      "claim, PaperTrail classifies the citation STANCE — supporting, contrasting, or mentioning — and extracts the " +
      "exact citation-context sentence, grounded verbatim to the citing text. Use this to understand *how* one paper " +
      "cites another (does it agree, dispute, or merely note it) rather than whether a claim is true.",
    method: "POST",
    path: "/api/citations/classify",
    inputSchema: obj(
      {
        citing_text: str({
          minLength: 20,
          maxLength: 6000,
          description:
            "The paragraph from the citing paper that contains the citation (20-6000 characters).",
        }),
        cited_claim: str({
          minLength: 10,
          maxLength: 2000,
          description: "A one-sentence summary of the cited work's finding (10-2000 characters).",
        }),
      },
      ["citing_text", "cited_claim"]
    ),
  },
  {
    name: "audit_guideline",
    description:
      "Paste a clinical guideline, press release, or marketing document and get a claim-by-claim audit: PaperTrail " +
      "extracts each efficacy claim with Claude and verifies it against primary sources, then summarises how many " +
      "claims are accurate, overstated, or unsupported. The numeric verdicts come from a deterministic verification " +
      "loop, not an LLM. Use this to screen a whole document for exaggerated or unsupported efficacy claims in one " +
      "pass; paste the efficacy/results section if the full document exceeds the 24000-character cap.",
    method: "POST",
    path: "/api/guideline-audit",
    inputSchema: obj(
      {
        text: str({
          minLength: 40,
          maxLength: 24000,
          description:
            "The document to audit (40-24000 characters), e.g. a guideline or press-release section.",
        }),
      },
      ["text"]
    ),
  },
  {
    name: "draft_with_evidence",
    description:
      "Evidence-grounded draft assistant. Give it a topic (a claim or short passage) and an optional section type, and " +
      "PaperTrail retrieves verified evidence, drafts the section with Claude grounded in that evidence, then " +
      "self-corrects every efficacy sentence against the verified findings. The response reports which sentences were " +
      "grounded vs corrected and whether the underlying evidence was sufficient. Use this to produce a first draft " +
      "whose efficacy statements are already checked against the literature. This is a read-only analysis: nothing is " +
      "saved to your workspace.",
    method: "POST",
    path: "/api/drafting",
    inputSchema: obj(
      {
        topic: str({
          minLength: 10,
          maxLength: 2000,
          description: "The claim or short passage to draft around (10-2000 characters).",
        }),
        section: str({
          description:
            "Optional section type to shape the draft (e.g. an introduction or results section).",
        }),
      },
      ["topic"]
    ),
  },

  // === synthesis.ts ==========================================================
  {
    name: "meta_analysis",
    description:
      "Pool two or more randomized-trial effect estimates (RR/HR/OR, given as point+CI or 2x2 counts) into " +
      "fixed-effect and random-effects summaries with Q, I-squared, tau-squared heterogeneity and a prediction " +
      "interval, then compare a stated claim's magnitude against the pooled effect. Use when a reviewer says " +
      "'Drug X cuts events by 30%' and you need to check whether the pooled trial evidence supports that " +
      "magnitude. Deterministic — no LLM in the numeric path.",
    method: "POST",
    path: "/api/synthesis",
    inputSchema: obj(
      {
        claim: str({
          minLength: 10,
          maxLength: 2000,
          description: "The efficacy claim to reconcile against the pooled effect.",
        }),
        studies: arr(ratioStudy, {
          minItems: 2,
          maxItems: 100,
          description: "At least two ratio-scale study effects to pool.",
        }),
      },
      ["claim", "studies"]
    ),
  },
  {
    name: "continuous_meta_analysis",
    description:
      "Pool two-arm studies reporting a CONTINUOUS endpoint (mean, SD and n per arm — e.g. blood-pressure change, " +
      "pain score) on the mean-difference (MD) or standardized mean difference / Hedges' g (SMD) scale, with " +
      "fixed- and random-effects summaries and Q / I-squared / tau-squared heterogeneity around a null of 0. Use " +
      "when the outcome is a measured quantity rather than an event count. Deterministic.",
    method: "POST",
    path: "/api/continuous-meta",
    inputSchema: obj(
      {
        studies: arr(
          obj(
            {
              label: str({ minLength: 1, maxLength: 200, description: "Study label." }),
              meanT: num({ description: "Treatment-arm mean." }),
              sdT: num({ exclusiveMinimum: 0, description: "Treatment-arm SD (>0)." }),
              nT: int({ minimum: 2, description: "Treatment-arm n (>=2)." }),
              meanC: num({ description: "Control-arm mean." }),
              sdC: num({ exclusiveMinimum: 0, description: "Control-arm SD (>0)." }),
              nC: int({ minimum: 2, description: "Control-arm n (>=2)." }),
            },
            ["label", "meanT", "sdT", "nT", "meanC", "sdC", "nC"]
          ),
          { minItems: 1, maxItems: 200, description: "Two-arm continuous-outcome studies." }
        ),
        measure: str({
          enum: ["MD", "SMD"],
          default: "MD",
          description: "Mean difference or standardized mean difference.",
        }),
      },
      ["studies"]
    ),
  },
  {
    name: "network_meta_analysis",
    description:
      "Estimate an A-vs-C treatment effect INDIRECTLY through a common comparator B using the Bucher method: supply " +
      "the A-vs-B and B-vs-C edges (each a pre-pooled log_effect+variance or a set of studies to pool). If a direct " +
      "A-vs-C edge is also given, it is inverse-variance combined with the indirect estimate and an incoherence " +
      "(inconsistency) test is reported. Use to compare two drugs never tested head-to-head. Deterministic.",
    method: "POST",
    path: "/api/network-meta",
    inputSchema: obj(
      {
        ab: { ...networkEdge, description: "A-vs-B edge (B is the common comparator)." },
        bc: { ...networkEdge, description: "B-vs-C edge (B is the common comparator)." },
        direct: { ...networkEdge, description: "Optional direct A-vs-C edge for a consistency check." },
      },
      ["ab", "bc"]
    ),
  },
  {
    name: "meta_regression",
    description:
      "Fit study-level effects (log-effect yi + variance vi) against a study-level moderator x — dose, baseline " +
      "risk, publication year — by inverse-variance weighted least squares with a mixed-effects (DerSimonian–Laird) " +
      "residual tau-squared. A significant slope means the moderator drives the effect and explains part of the " +
      "heterogeneity. Needs >=3 studies with >=2 distinct moderator values. Use to test whether an effect depends " +
      "on a covariate. Deterministic.",
    method: "POST",
    path: "/api/meta-regression",
    inputSchema: obj(
      {
        points: arr(
          obj(
            { ...logPointProps, x: num({ description: "Moderator value." }) },
            ["label", "yi", "vi", "x"]
          ),
          {
            minItems: 3,
            maxItems: 200,
            description: "Study points with a moderator x (>=3 points, >=2 distinct x).",
          }
        ),
        moderator: str({
          minLength: 1,
          maxLength: 120,
          description: "Name of the moderator, echoed back.",
        }),
        claim: str({ minLength: 1, maxLength: 2000, description: "Optional claim context (never logged)." }),
        residualHeterogeneity: bool({
          description: "Include a residual tau-squared term (mixed-effects).",
        }),
      },
      ["points"]
    ),
  },
  {
    name: "subgroup_analysis",
    description:
      "Pool each named subgroup (each a set of ratio-scale study effects), run the deterministic test for subgroup " +
      "differences (Q-between, interaction p-value), and return a verdict on whether a claim rests on ONE subgroup " +
      "rather than the overall trial effect. Use to catch cherry-picked subgroup findings dressed up as the " +
      "headline result. Deterministic.",
    method: "POST",
    path: "/api/subgroup",
    inputSchema: obj(
      {
        claim: str({
          minLength: 10,
          maxLength: 2000,
          description: "The claim to check against the subgroup structure.",
        }),
        subgroups: arr(
          obj(
            {
              name: str({ minLength: 1, maxLength: 200 }),
              studies: arr(nullableRatioStudy, { minItems: 1, maxItems: 100 }),
            },
            ["name", "studies"]
          ),
          {
            minItems: 1,
            maxItems: 20,
            description: "One or more named subgroups, each with its own studies.",
          }
        ),
      },
      ["claim", "subgroups"]
    ),
  },
  {
    name: "survival_analysis",
    description:
      "Reconcile a time-to-event claim against reported survival statistics: a hazard ratio + CI, per-arm median " +
      "survival times (deterministic median ratio), and/or Kaplan–Meier survival probabilities at a landmark " +
      "timepoint (absolute risk reduction and NNT). Use to check claims like 'improved median survival by 4 months' " +
      "or 'halved the risk of death'. Deterministic.",
    method: "POST",
    path: "/api/survival",
    inputSchema: obj(
      {
        claim: str({ minLength: 10, maxLength: 2000, description: "The survival / time-to-event claim." }),
        hazardRatio: num({ exclusiveMinimum: 0, description: "Reported hazard ratio (>0)." }),
        hrCiLower: num({ exclusiveMinimum: 0, description: "HR lower CI bound." }),
        hrCiUpper: num({ exclusiveMinimum: 0, description: "HR upper CI bound." }),
        medianTreatment: num({ exclusiveMinimum: 0, description: "Treatment-arm median survival." }),
        medianControl: num({ exclusiveMinimum: 0, description: "Control-arm median survival." }),
        survivalControl: num({
          minimum: 0,
          maximum: 1,
          description: "Control-arm KM survival prob (0..1) at timepoint.",
        }),
        survivalTreatment: num({
          minimum: 0,
          maximum: 1,
          description: "Treatment-arm KM survival prob (0..1) at timepoint.",
        }),
        timepoint: num({ exclusiveMinimum: 0, description: "Landmark timepoint for the KM probabilities." }),
      },
      ["claim"]
    ),
  },
  {
    name: "dose_response_analysis",
    description:
      "Fit a linear dose-response trend across dose-stratified effect estimates (each a log-effect yi + variance vi " +
      "at a dose level, all vs a COMMON reference) by inverse-variance weighted least squares and test the slope " +
      "against zero. A significant slope means 'more drug -> more effect' — a gradient single-comparison checkers " +
      "miss. Needs >=3 points across >=2 distinct doses. Deterministic.",
    method: "POST",
    path: "/api/dose-response",
    inputSchema: obj(
      {
        points: arr(
          obj(
            { ...logPointProps, dose: num({ description: "Dose level for this point." }) },
            ["label", "yi", "vi", "dose"]
          ),
          {
            minItems: 3,
            maxItems: 200,
            description: "Dose-stratified points (>=3 points, >=2 distinct doses).",
          }
        ),
        doseUnit: str({
          minLength: 1,
          maxLength: 60,
          description: "Dose axis unit, e.g. 'mg/day' (echoed back).",
        }),
        claim: str({ minLength: 1, maxLength: 2000, description: "Optional claim context (never logged)." }),
      },
      ["points"]
    ),
  },
  {
    name: "trial_sequential_analysis",
    description:
      "Answer the question a generic significance test cannot: is the pooled evidence CONCLUSIVE, or is more data " +
      "still needed? Three modes. mode='ris' computes the Required Information Size for a definitive body of " +
      "evidence (from control risk, relative risk reduction, alpha, power, optional I-squared). mode='boundary' " +
      "returns the O'Brien–Fleming alpha-spending Z boundary at an information fraction. mode='verdict' classifies " +
      "accrued evidence as conclusive_benefit / conclusive_no_effect / insufficient. Deterministic.",
    method: "POST",
    path: "/api/trial-sequential",
    inputSchema: obj(
      {
        mode: str({ enum: ["ris", "boundary", "verdict"], description: "Which analysis to run." }),
        controlRisk: num({
          exclusiveMinimum: 0,
          exclusiveMaximum: 1,
          description: "[ris] Control-arm event risk in (0,1).",
        }),
        relativeRiskReduction: num({
          exclusiveMinimum: 0,
          exclusiveMaximum: 1,
          description: "[ris] Target relative risk reduction in (0,1).",
        }),
        iSquared: num({
          minimum: 0,
          maximum: 0.999,
          description: "[ris] Heterogeneity for diversity adjustment.",
        }),
        informationFraction: num({
          exclusiveMinimum: 0,
          maximum: 1,
          description: "[boundary] Fraction of RIS accrued (0,1].",
        }),
        accruedN: num({ minimum: 0, description: "[verdict] Participants accrued so far." }),
        ris: num({ exclusiveMinimum: 0, description: "[verdict] Required Information Size." }),
        cumulativeZ: num({ description: "[verdict] Cumulative Z statistic." }),
        alpha: num({
          exclusiveMinimum: 0,
          exclusiveMaximum: 1,
          description: "Two-sided alpha (default 0.05).",
        }),
        power: num({
          exclusiveMinimum: 0,
          exclusiveMaximum: 1,
          description: "[ris] Desired power (default 0.8).",
        }),
      },
      ["mode"]
    ),
  },
  {
    name: "risk_of_bias",
    description:
      "Assess a single randomized trial from explicit, reviewer-answerable facts (randomization, allocation " +
      "concealment, blinding, attrition/ITT, selective reporting, plus pragmatic flags) and return per-domain " +
      "judgements, an overall judgement, and the GRADE downgrade step count. Use before pooling to appraise each " +
      "trial's internal validity. Deterministic rules — no LLM.",
    method: "POST",
    path: "/api/risk-of-bias",
    inputSchema: obj(
      {
        randomSequenceGenerated: bool({ description: "Was a genuine random sequence generated?" }),
        allocationConcealed: bool({
          description: "Was the upcoming assignment hidden from enrollers?",
        }),
        blinding: str({
          enum: ["double_blind", "single_blind", "open_label", "unclear"],
          description: "Blinding of participants/personnel.",
        }),
        outcomeAssessorBlinded: bool({ description: "Was the outcome assessor blinded?" }),
        outcomeType: str({
          enum: ["objective", "subjective"],
          description: "Objective outcomes are robust to lack of blinding.",
        }),
        attritionRate: num({ minimum: 0, maximum: 1, description: "Overall dropout proportion (0..1)." }),
        intentionToTreat: bool({ description: "Was the analysis intention-to-treat?" }),
        preRegistered: bool({ description: "Was the trial pre-registered?" }),
        allPrespecifiedOutcomesReported: bool({
          description: "Were all pre-specified primary outcomes reported?",
        }),
        sampleSize: { type: ["integer", "null"], exclusiveMinimum: 0, description: "Total sample size (pragmatic flag)." },
        stoppedEarlyForBenefit: bool({ description: "Was the trial stopped early for benefit?" }),
        funding: str({
          enum: ["public", "mixed", "industry_only", "unclear"],
          description: "Funding source.",
        }),
      },
      [
        "randomSequenceGenerated",
        "allocationConcealed",
        "blinding",
        "outcomeAssessorBlinded",
        "outcomeType",
        "attritionRate",
        "intentionToTreat",
        "preRegistered",
        "allPrespecifiedOutcomesReported",
      ]
    ),
  },
  {
    name: "evidence_report",
    description:
      "Chain the deterministic engines into one defensible object: meta-analysis of the supplied ratio-scale trial " +
      "effects, Egger's publication-bias test, GRADE certainty rating, and the claim-vs-pool verdict — optionally " +
      "translated into absolute effects (ARR / NNT / events per 1000) when a baseline risk is given. Supply your " +
      "own risk-of-bias and indirectness downgrade steps; publication bias is computed, not declared. Use to " +
      "produce a full appraisal of a claim from a study list you already have. Deterministic.",
    method: "POST",
    path: "/api/evidence-report",
    inputSchema: obj(
      {
        claim: str({ minLength: 10, maxLength: 2000, description: "The claim to appraise." }),
        studies: arr(ratioStudy, {
          minItems: 1,
          maxItems: 100,
          description: "Ratio-scale trial effects to pool and appraise.",
        }),
        risk_of_bias_steps: int({
          minimum: 0,
          maximum: 2,
          description: "GRADE risk-of-bias downgrade steps (0-2).",
        }),
        indirectness_steps: int({
          minimum: 0,
          maximum: 2,
          description: "GRADE indirectness downgrade steps (0-2).",
        }),
        baselineRisk: num({
          exclusiveMinimum: 0,
          exclusiveMaximum: 1,
          description: "Assumed control-arm risk in (0,1) for absolute effects.",
        }),
      },
      ["claim", "studies"]
    ),
  },
  {
    name: "evidence_pipeline",
    description:
      "Give a plain-language efficacy claim and PaperTrail finds its OWN primary sources (PubMed / " +
      "ClinicalTrials.gov), extracts the effect estimates, pools them, and returns the same composite evidence " +
      "report as evidence_report — no study list required from you. Optionally steer retrieval with a query and " +
      "cap the number of candidate sources. Use this as the one-call path from a claim to a defensible appraisal. " +
      "Reaches live external registries; the numeric loop is still deterministic.",
    method: "POST",
    path: "/api/evidence-pipeline",
    inputSchema: obj(
      {
        claim: str({
          minLength: 10,
          maxLength: 2000,
          description: "The efficacy claim to verify against the literature.",
        }),
        query: str({
          minLength: 1,
          maxLength: 2000,
          description: "Optional search-steering query; defaults to the claim text.",
        }),
        limit: int({ minimum: 1, maximum: 20, description: "Max candidate sources to retrieve (1-20)." }),
      },
      ["claim"]
    ),
  },

  // === biomedicalCore.ts =====================================================
  {
    name: "bio_annotate_entities",
    description:
      "Ground free biomedical text OR a batch of PubMed IDs into normalized entities " +
      "(genes, diseases, chemicals/drugs, variants, species) via NCBI PubTator Central. " +
      "Returns each mention with its normalized identifier (e.g. NCBI Gene / MeSH / dbSNP) " +
      "and character offsets, plus a de-duplicated per-type grouping. Every entity is one " +
      "PubTator actually resolved — nothing is invented; unrecognized input yields an honest " +
      "empty result. USE THIS FIRST to disambiguate the exact gene/disease/drug/variant tokens " +
      "in a claim before routing to the specific evidence engines below. Provide exactly one of " +
      "`pmids` or `text`.",
    method: "POST",
    path: "/api/bio/annotate",
    inputSchema: obj({
      pmids: arr(str(), {
        minItems: 1,
        maxItems: 50,
        description: "Up to 50 PubMed IDs to fetch pre-computed annotations for.",
      }),
      text: str({
        minLength: 1,
        maxLength: 10000,
        description: "A free-text passage (max 10000 chars) to annotate on the fly.",
      }),
    }),
  },
  {
    name: "bio_safety_signal",
    description:
      "Detect a drug–adverse-event safety signal using FDA FAERS spontaneous reports. " +
      "Two deterministic modes (no LLM in the numeric path): (1) live — provide `drug` and " +
      "`event` (e.g. drug=\"rofecoxib\", event=\"myocardial infarction\") to fetch the drug–event " +
      "2x2 from openFDA and compute disproportionality (PRR, ROR, chi-square with Yates, and the " +
      "Information Component with its IC025 lower bound); (2) offline — provide a pre-assembled " +
      "2x2 (`a`,`b`,`c`,`d`) to reproduce a published contingency table with zero network calls. " +
      "USE THIS to check whether a claimed adverse-event association is statistically supported in " +
      "post-marketing surveillance. A missing FAERS pair returns an honest found:false, never a " +
      "fabricated signal. Provide either {drug,event} or {a,b,c,d}.",
    method: "POST",
    path: "/api/bio/safety-signal",
    inputSchema: obj({
      drug: str({ minLength: 1, maxLength: 200, description: "Drug name (live FAERS mode)." }),
      event: str({
        minLength: 1,
        maxLength: 200,
        description: "Adverse event / MedDRA-style term (live FAERS mode).",
      }),
      a: int({ minimum: 0, description: "2x2 cell a: reports with BOTH the drug and the event." }),
      b: int({ minimum: 0, description: "2x2 cell b: drug, not the event." }),
      c: int({ minimum: 0, description: "2x2 cell c: event, not the drug." }),
      d: int({ minimum: 0, description: "2x2 cell d: neither." }),
    }),
  },
  {
    name: "bio_genetic_association",
    description:
      "Verify a claimed gene/variant–disease genetic association against the EBI GWAS Catalog and " +
      "NCBI ClinVar. Provide `disease` plus at least one of `gene` (symbol) or `variant` (rsID). " +
      "Returns a deterministic verdict decided by field-standard thresholds — genome_wide_significant " +
      "(p ≤ 5e-8), suggestive, reported_not_significant, clinvar_pathogenic, conflicting, or " +
      "no_association_found — with the supporting GWAS and ClinVar records and the minimum p-value. " +
      "No LLM is in the loop; an empty upstream response yields an honest no_association_found rather " +
      "than a guess. USE THIS to check whether a genetics claim (e.g. \"PCSK9 variants associate with " +
      "coronary artery disease\") holds at genome-wide significance.",
    method: "POST",
    path: "/api/bio/genetic-association",
    inputSchema: obj(
      {
        gene: str({ minLength: 1, maxLength: 64, description: "Gene symbol, e.g. PCSK9." }),
        variant: str({ minLength: 1, maxLength: 64, description: "Variant rsID, e.g. rs11591147." }),
        disease: str({ minLength: 2, maxLength: 200, description: "Disease / trait name (required)." }),
      },
      ["disease"]
    ),
  },
  {
    name: "bio_variant_pathogenicity",
    description:
      "Verify a claimed variant clinical significance against NCBI ClinVar. Provide at least one of " +
      "`rsId`, `hgvs`, or `gene`, optionally scoped by `condition`, and optionally a " +
      "`claimedSignificance` (e.g. \"pathogenic\") to check against. Returns a deterministic verdict — " +
      "confirmed, overstated_certainty (the claim asserts pathogenic but ClinVar is a VUS/benign or a " +
      "low-star submission), conflicting, or not_found — with the highest ClinVar review-status " +
      "(star-rated) record. The verdict follows ClinVar's documented review-status→star scale; no LLM " +
      "is involved, and an empty response yields an honest not_found. USE THIS to check whether a " +
      "\"variant X is pathogenic for condition Y\" claim is actually supported at adequate review " +
      "confidence.",
    method: "POST",
    path: "/api/bio/variant-pathogenicity",
    inputSchema: obj({
      rsId: str({ minLength: 1, maxLength: 64, description: "dbSNP rsID, e.g. rs80357906." }),
      hgvs: str({ minLength: 1, maxLength: 256, description: "HGVS expression for the variant." }),
      gene: str({ minLength: 1, maxLength: 64, description: "Gene symbol to search within." }),
      condition: str({ minLength: 1, maxLength: 200, description: "Condition to scope the lookup to." }),
      claimedSignificance: str({
        minLength: 1,
        maxLength: 64,
        description: "The clinical significance being claimed, e.g. pathogenic / likely benign.",
      }),
    }),
  },
  {
    name: "bio_target_disease",
    description:
      "Aggregate target–disease association evidence from the Open Targets Platform. Provide `target` " +
      "(gene symbol, e.g. PCSK9) and `disease` (name, e.g. hypercholesterolemia). Resolves the Ensembl " +
      "gene id and EFO disease id, then returns Open Targets' deterministic association scores — overall " +
      "plus per-datatype (genetic, known-drug, literature, animal-model) — along with known drugs and " +
      "target tractability. Scores come straight from the API; no LLM touches the numbers. Set " +
      "`summarize` to true to additionally get a Claude-written plain-language summary that references " +
      "only the returned data (it never alters a score). USE THIS to gauge how well a therapeutic target " +
      "is supported for a given indication before pursuing it.",
    method: "POST",
    path: "/api/bio/target-disease",
    queryKeys: ["summarize"],
    inputSchema: obj(
      {
        target: str({ minLength: 1, maxLength: 100, description: "Target gene symbol, e.g. PCSK9." }),
        disease: str({
          minLength: 1,
          maxLength: 200,
          description: "Disease name, e.g. hypercholesterolemia.",
        }),
        summarize: bool({
          description: "If true, append a Claude plain-language summary of the deterministic scores.",
        }),
      },
      ["target", "disease"]
    ),
  },

  // === biomedicalExtra.ts ====================================================
  {
    name: "bio_verify_claim",
    description:
      "Verify a free-text biomedical claim end-to-end and return ONE unified verdict. Provide `claim` " +
      "(e.g. \"PCSK9 loss-of-function protects against coronary artery disease\"). The engine extracts " +
      "the claim's entities with PubTator to ROUTE which checks apply, runs only the relevant " +
      "deterministic engines in parallel (genetics, variant pathogenicity, target–disease, safety, " +
      "bioactivity, pharmacogenomics), and composes their component verdicts into an overall verdict " +
      "with a rationale and the per-check breakdown. The overall verdict is a PURE deterministic " +
      "function of the components — no LLM is in the decision path. A claim with no runnable entity " +
      "returns insufficient_evidence rather than a fabricated confident answer. USE THIS as the default, " +
      "one-shot entry point when you have a biomedical assertion and want the strongest available check " +
      "without deciding which engine to call.",
    method: "POST",
    path: "/api/bio/verify-claim",
    inputSchema: obj(
      {
        claim: str({ minLength: 3, maxLength: 2000, description: "The biomedical claim sentence to verify." }),
      },
      ["claim"]
    ),
  },
  {
    name: "bio_bioactivity",
    description:
      "Verify a drug's potency, clinical phase, and mechanism against measured ChEMBL bioactivities. " +
      "Provide `drug` (required) and any of `target`, `claimedPotencyNM` (claimed potency in nanomolar), " +
      "`claimedMechanism`, and `claimedPhase` (0–4). Resolves the drug to its ChEMBL id, fetches " +
      "IC50/Ki/Kd/EC50 measurements, and returns deterministic verdicts: potency " +
      "confirmed_within_order / overstated / understated / not_found (order-of-magnitude band on nM), " +
      "phase confirmed / overstated / understated / not_found (claimed vs ChEMBL max_phase), and a " +
      "mechanism-consistency check — with the supporting activity records. No LLM in the loop; " +
      "unresolved drugs degrade to honest not_found. Results carry a ChEMBL CC BY-SA 3.0 attribution. " +
      "USE THIS to fact-check a stated drug potency, development stage, or mechanism.",
    method: "POST",
    path: "/api/bio/bioactivity",
    inputSchema: obj(
      {
        drug: str({ minLength: 1, maxLength: 200, description: "Drug name (required)." }),
        target: str({
          minLength: 1,
          maxLength: 200,
          description: "Target gene/protein to scope activities.",
        }),
        claimedPotencyNM: num({
          exclusiveMinimum: 0,
          description: "Claimed potency in nanomolar (nM) to compare against measured values.",
        }),
        claimedMechanism: str({
          minLength: 1,
          maxLength: 300,
          description: "Claimed mechanism of action to check for consistency.",
        }),
        claimedPhase: int({
          minimum: 0,
          maximum: 4,
          description: "Claimed max clinical phase (0–4) to compare against ChEMBL.",
        }),
      },
      ["drug"]
    ),
  },
  {
    name: "bio_pharmacogenomics",
    description:
      "Verify a gene/variant–drug pharmacogenomic annotation against PharmGKB / ClinPGx. Provide `drug` " +
      "(required) plus an optional `gene` or `variant` (e.g. gene=\"CYP2C19\", variant=\"*2\") and an " +
      "optional `claimedEffect` to check. Returns a deterministic verdict — high_confidence (PharmGKB " +
      "evidence level 1A/1B), moderate (2A/2B), preliminary (3/4), or not_found — with the strongest " +
      "matching clinical annotation and the supporting records. The verdict follows PharmGKB's documented " +
      "evidence-level ordering; no LLM is involved, and an empty response yields honest not_found. Returned " +
      "content is PharmGKB / ClinPGx data (CC BY-SA 4.0; a share-alike attribution is included). USE THIS " +
      "to check whether a gene-guided-dosing or drug-response claim is backed by graded clinical evidence.",
    method: "POST",
    path: "/api/bio/pharmacogenomics",
    inputSchema: obj(
      {
        drug: str({ minLength: 1, maxLength: 200, description: "Drug name (required)." }),
        gene: str({ minLength: 1, maxLength: 64, description: "Gene symbol, e.g. CYP2C19." }),
        variant: str({
          minLength: 1,
          maxLength: 64,
          description: "Variant / star allele, e.g. *2 or rs4244285.",
        }),
        claimedEffect: str({
          minLength: 1,
          maxLength: 500,
          description: "The pharmacogenomic effect being claimed, to check against annotations.",
        }),
      },
      ["drug"]
    ),
  },
  {
    name: "bio_drug_interaction",
    description:
      "Screen for a drug–drug-interaction signal from FDA FAERS spontaneous reports. Provide `drugA`, " +
      "`drugB`, and `event` (e.g. drugA=\"warfarin\", drugB=\"fluconazole\", event=\"haemorrhage\"). " +
      "Assembles disproportionality (PRR / ROR / chi² / Information Component) for the event among reports " +
      "listing BOTH drugs, contrasts it against each single-drug signal, and returns a deterministic " +
      "verdict: synergistic_signal, no_excess, or insufficient_data. No LLM is in the numeric path — every " +
      "number is a closed-form statistic over open report counts. This is a hypothesis-generating screen, " +
      "NOT proof of a causal interaction; upstream gaps return honest-null blocks with insufficient_data. " +
      "USE THIS to check whether co-reporting of two drugs is disproportionately linked to an adverse event.",
    method: "POST",
    path: "/api/bio/drug-interaction",
    inputSchema: obj(
      {
        drugA: str({ minLength: 1, maxLength: 200, description: "First drug name." }),
        drugB: str({ minLength: 1, maxLength: 200, description: "Second drug name." }),
        event: str({ minLength: 1, maxLength: 200, description: "Adverse event term to screen for." }),
      },
      ["drugA", "drugB", "event"]
    ),
  },
  {
    name: "bio_repurposing",
    description:
      "Assemble a deterministic drug-repurposing evidence bundle for a proposed drug↔indication link. " +
      "Provide `drug` and `indication` (e.g. drug=\"metformin\", indication=\"colorectal cancer\"). " +
      "Combines four engines — Open Targets (genetic target↔indication association), ChEMBL (max clinical " +
      "phase + target bioactivity), ClinicalTrials.gov (existing trials, including failures), and FAERS " +
      "(pharmacovigilance) — into a composite score in [0,1] and a verdict: strong_rationale, plausible, " +
      "weak, or discouraged. No LLM is in the numeric path. Set `summarize` to true to add a Claude " +
      "plain-language summary that references only the assembled evidence (it never changes a number). " +
      "USE THIS to gauge whether repurposing an existing drug for a new indication is scientifically " +
      "supported before deeper investigation.",
    method: "POST",
    path: "/api/bio/repurposing",
    queryKeys: ["summarize"],
    inputSchema: obj(
      {
        drug: str({ minLength: 1, maxLength: 200, description: "Existing drug to repurpose." }),
        indication: str({ minLength: 1, maxLength: 200, description: "Proposed new indication." }),
        summarize: bool({
          description: "If true, append a Claude plain-language summary of the deterministic bundle.",
        }),
      },
      ["drug", "indication"]
    ),
  },
  {
    name: "bio_biomarker",
    description:
      "Assemble deterministic validation evidence for a claimed biomarker↔disease (or biomarker↔drug-" +
      "response) relationship. Provide `biomarker` and `disease`, optionally `drug` (e.g. " +
      "biomarker=\"CYP2C19*2\", disease=\"clopidogrel resistance\", drug=\"clopidogrel\"). Combines four " +
      "engines — genetic association (GWAS Catalog + ClinVar), target-disease genetic score (Open Targets), " +
      "literature grounding (PubTator co-mention), and pharmacogenomic context (PharmGKB) — into a " +
      "deterministic validationLevel: analytically_grounded, emerging, weak, or unsupported, with the " +
      "assembled evidence and a rationale. No LLM is in the decision path. Set `summarize` to true for a " +
      "Claude plain-language summary (references only the assembled evidence). USE THIS to judge how well a " +
      "candidate biomarker is validated for a disease or drug-response endpoint.",
    method: "POST",
    path: "/api/bio/biomarker",
    queryKeys: ["summarize"],
    inputSchema: obj(
      {
        biomarker: str({ minLength: 1, maxLength: 100, description: "Biomarker, e.g. BRCA1 or CYP2C19*2." }),
        disease: str({ minLength: 2, maxLength: 200, description: "Disease or drug-response endpoint." }),
        drug: str({
          minLength: 1,
          maxLength: 200,
          description: "Optional drug context for a biomarker↔drug-response claim.",
        }),
        summarize: bool({
          description: "If true, append a Claude plain-language summary of the deterministic validation.",
        }),
      },
      ["biomarker", "disease"]
    ),
  },

  // === research.ts ===========================================================
  {
    name: "paper_qa",
    description:
      "Answer a focused scientific question over PaperTrail's cached primary literature, with citations. " +
      "Claude retrieves the relevant papers, reads their full text, and returns an answer where every " +
      "rendered claim is grounded to an exact source span (PaperQA2-style); ungroundable claims are dropped. " +
      "USE WHEN you have a single, well-scoped factual question (e.g. 'What was the primary-endpoint hazard " +
      "ratio for empagliflozin in EMPA-REG?') and want a cited, source-anchored answer rather than a web guess. " +
      "Returns 'no_support_found' honestly when no cached source confidently supports an answer. Runs several " +
      "LLM + retrieval calls, so expect a few seconds.",
    method: "POST",
    path: "/api/paper-qa",
    inputSchema: obj(
      {
        question: str({
          minLength: 10,
          maxLength: 2000,
          description: "A single focused scientific question (10-2000 chars).",
        }),
        limit: int({ minimum: 1, maximum: 8, description: "Max papers to read (1-8). Omit for the default." }),
      },
      ["question"]
    ),
  },
  {
    name: "deep_research",
    description:
      "Run a grounded, multi-agent deep-research report on a research question (gpt-researcher / " +
      "open_deep_research style). Claude PLANS 3-6 focused sub-questions, the deterministic evidence " +
      "pipeline gathers verified pooled evidence for each, and Claude SYNTHESISES a structured, cited report " +
      "— every number from the engine, every claim grounded to an exact source span. " +
      "USE WHEN a question is broad enough to need decomposition and cross-source synthesis (e.g. 'What is the " +
      "cardiovascular safety profile of the GLP-1 receptor agonist class?'). " +
      "EXPENSIVE and SLOW: it fans out many Claude + pipeline calls and is heavily rate-limited. It can run " +
      "well beyond the default 120s client timeout — raise PAPERTRAIL_BASE_URL client timeout if the connector " +
      "supports it, and prefer paper_qa or synthesis_report for narrower asks.",
    method: "POST",
    path: "/api/deep-research",
    inputSchema: obj(
      {
        question: str({
          minLength: 10,
          maxLength: 2000,
          description: "A broad research question to decompose and investigate (10-2000 chars).",
        }),
      },
      ["question"]
    ),
  },
  {
    name: "research_brief",
    description:
      "Produce a cited research brief using PaperTrail's native parallel deep-research orchestrator over its " +
      "cached sources (plan -> parallel sub-query research -> per-source compression -> cited report), grounded " +
      "to real source spans. Similar intent to deep_research but a lighter, self-contained orchestration that " +
      "returns the plan, per-source compressed evidence, and a cited summary in one payload. " +
      "USE WHEN you want a fast, structured, cited overview of a topic against the cached corpus and don't need " +
      "the heavier full evidence pipeline. Runs multiple LLM calls, so expect a short wait.",
    method: "POST",
    path: "/api/research",
    inputSchema: obj(
      {
        question: str({
          minLength: 10,
          maxLength: 2000,
          description: "The research question to brief (10-2000 chars).",
        }),
      },
      ["question"]
    ),
  },
  {
    name: "research_gaps_hypotheses",
    description:
      "Surface research gaps and testable hypotheses for a topic or claim, grounded in real evidence signals. " +
      "The route first runs the deterministic evidence pipeline (retrieve cached primary sources -> pool -> " +
      "meta-analysis / publication-bias / GRADE), then has Claude reason ONLY over those engine-established " +
      "signals — dropping any gap or hypothesis not anchored to a real signal. " +
      "USE WHEN a scientist wants to know 'what's missing' or 'what to test next' for a subject (e.g. topic " +
      "'PCSK9 inhibition in primary prevention') and needs the ideas tied to actual evidence, not free " +
      "speculation.",
    method: "POST",
    path: "/api/hypotheses",
    inputSchema: obj(
      {
        topic: str({
          minLength: 10,
          maxLength: 2000,
          description: "The topic or claim to analyse for gaps (10-2000 chars).",
        }),
        query: str({
          minLength: 1,
          maxLength: 2000,
          description: "Optional search-steering query to focus retrieval.",
        }),
        limit: int({
          exclusiveMinimum: 0,
          maximum: 20,
          description: "Optional cap on retrieved candidate sources (1-20).",
        }),
      },
      ["topic"]
    ),
  },
  {
    name: "extract_paper",
    description:
      "Extract structured findings from a paper: PICO, endpoints, and every reported effect size " +
      "(RobotReviewer / LlamaExtract-style). Claude reads the full text; the deterministic trust layer then " +
      "grounds each effect's quote to an exact source span and reconciles its number, dropping any effect it " +
      "can't ground. Provide EITHER 'text' (paste the abstract + results, up to 60k chars) OR 'source_id' (a " +
      "cached source UUID) — exactly one. " +
      "USE WHEN you need a machine-readable table of a study's outcomes and effect sizes rather than prose.",
    method: "POST",
    path: "/api/extraction/paper",
    inputSchema: obj({
      text: str({
        minLength: 100,
        maxLength: 60000,
        description: "Full paper text (abstract + results). Provide this OR source_id.",
      }),
      source_id: str({
        format: "uuid",
        description: "UUID of a cached PaperTrail source. Provide this OR text.",
      }),
    }),
  },
  {
    name: "assemble_mechanism",
    description:
      "Extract causal mechanistic statements (subject-relation-object, e.g. 'drug X inhibits kinase Y') from a " +
      "passage and score them (native INDRA port). Claude proposes candidate tuples with an evidence quote; the " +
      "quote is grounded verbatim (ungroundable ones dropped), statements are de-duplicated, and each gets a " +
      "DETERMINISTIC belief = 1 - prod(1 - reliability_i). Each statement is persisted as a provenance-bearing " +
      "edge in the knowledge graph when the DB is available. " +
      "USE WHEN you want the machine-readable causal relationships (activates/inhibits/phosphorylates/binds/" +
      "regulates) stated in a piece of text, with an auditable belief score. Set 'tier' to declare how reliable " +
      "the source of the text is (defaults to 'abstract').",
    method: "POST",
    path: "/api/mechanism",
    inputSchema: obj(
      {
        text: str({
          minLength: 40,
          maxLength: 20000,
          description: "The source passage to extract mechanisms from (40-20000 chars).",
        }),
        tier: str({
          enum: ["curated_database", "full_text", "abstract", "preprint"],
          description:
            "Provenance tier of the text, driving per-evidence reliability. Defaults to 'abstract'.",
        }),
      },
      ["text"]
    ),
  },
  {
    name: "synthesis_report",
    description:
      "Generate a long-form, fully-cited evidence review for a topic or claim (STORM-style). The deterministic " +
      "evidence pipeline supplies every number; Claude drafts the prose; every factual sentence is grounded to a " +
      "source span before it reaches you (ungrounded sentences dropped). " +
      "USE WHEN you want a readable narrative review with citations and a certainty read on a subject (e.g. " +
      "'statins and diabetes risk'), rather than a raw effect table or a single QA answer. Runs the full pipeline " +
      "plus drafting, so expect a short wait.",
    method: "POST",
    path: "/api/synthesis-report",
    inputSchema: obj(
      {
        topic: str({
          minLength: 10,
          maxLength: 2000,
          description: "The topic or claim to review (10-2000 chars).",
        }),
        query: str({
          minLength: 1,
          maxLength: 2000,
          description: "Optional search-steering query to focus retrieval.",
        }),
        limit: int({ minimum: 1, maximum: 20, description: "Optional cap on retrieved candidate sources (1-20)." }),
      },
      ["topic"]
    ),
  },
  {
    name: "knowledge_graph",
    description:
      "Work with PaperTrail's biomedical evidence knowledge graph. Exactly one mode per call: " +
      "'ingest' grounds free text to normalized entities (PubTator) and derives typed, provenance-bearing edges " +
      "from the deterministic bio-relation engines (genetic association, Open Targets), persisting nodes + edges; " +
      "'path' returns a provenance-annotated evidence path between two normalized entity ids (or null if none). " +
      "No LLM sits in any edge confidence — entity linking is PubTator's, edge scores are the bio engines'. " +
      "USE 'ingest' to grow the graph from a passage; USE 'path' to ask 'how is entity A connected to entity B?' " +
      "(e.g. from an EFO disease id to an Ensembl gene id). Requires the graph DB to be configured.",
    method: "POST",
    path: "/api/kg",
    inputSchema: obj({
      ingest: obj(
        {
          text: str({
            minLength: 1,
            maxLength: 10000,
            description: "Free text to ground and derive edges from (1-10000 chars).",
          }),
        },
        ["text"]
      ),
      path: obj(
        {
          from: str({ minLength: 1, maxLength: 128, description: "Normalized entity id to start from." }),
          to: str({ minLength: 1, maxLength: 128, description: "Normalized entity id to reach." }),
          maxHops: int({
            minimum: 1,
            maximum: 6,
            description: "Max edges in the path (1-6). Omit for the default.",
          }),
        },
        ["from", "to"]
      ),
    }),
  },
  {
    name: "kg_link_predict",
    description:
      "Predict NOVEL associations from a starting entity by ranking candidate object nodes on their structural " +
      "proximity in the evidence graph — a repurposing / hypothesis-generation list. Scorers are pure topology " +
      "math ported from PyKEEN's non-parametric baselines (common-neighbors, Adamic-Adar, resource-allocation, " +
      "preferential-attachment); NO LLM is in any score. When you pin a 'predicate', candidates are additionally " +
      "filtered to respect its Biolink domain/range, so ill-typed guesses are dropped. " +
      "USE WHEN you have a normalized entity id (from knowledge_graph ingest or a bio tool) and want ranked, " +
      "not-yet-linked candidates — e.g. novel drug->disease ('treats') or gene->disease ('associates_with') leads.",
    method: "POST",
    path: "/api/kg/predict",
    inputSchema: obj(
      {
        from: str({ minLength: 1, maxLength: 128, description: "Normalized entity id to predict links from." }),
        predicate: str({
          enum: ["associates_with", "targets", "treats"],
          description: "Optional target relation; enforces Biolink well-typing on candidates.",
        }),
        scorer: str({
          enum: [
            "common_neighbors",
            "adamic_adar",
            "resource_allocation",
            "preferential_attachment",
          ],
          description: "Topology scorer to rank candidates. Defaults to adamic_adar.",
        }),
        radius: int({ minimum: 1, maximum: 4, description: "Neighborhood radius to consider (1-4)." }),
        limit: int({ minimum: 1, maximum: 200, description: "Max predictions to return (1-200)." }),
      },
      ["from"]
    ),
  },
  {
    name: "extract_entities",
    description:
      "Run biomedical NER + entity linking over a passage (native scispaCy port). Claude proposes candidate " +
      "gene/disease/chemical/variant mentions; a deterministic native linker maps each to a normalized concept id " +
      "(UMLS CUI / MeSH), each mention is grounded verbatim to the input (ungroundable ones dropped), and " +
      "abbreviations are resolved (Schwartz-Hearst). The normalized ids and scores are NOT LLM numbers. " +
      "USE WHEN you need the normalized entities in a text — e.g. to feed knowledge_graph or kg_link_predict, or " +
      "to canonicalize the genes/diseases/drugs a passage mentions.",
    method: "POST",
    path: "/api/entities",
    inputSchema: obj(
      {
        text: str({
          minLength: 3,
          maxLength: 20000,
          description: "The source text to recognize entities in (3-20000 chars).",
        }),
      },
      ["text"]
    ),
  },
  {
    name: "hybrid_retrieval",
    description:
      "Search PaperTrail's cached sources with hybrid retrieval — vector + full-text fused by Reciprocal Rank " +
      "Fusion, with optional graph expansion (native R2R hybrid_search port). Returns the best-first source hits " +
      "with their RRF provenance (which ranks fed each score) and a short snippet per hit. " +
      "USE WHEN you want to find the most relevant cached sources for a query before doing deeper work (QA, " +
      "extraction, synthesis), or to see what PaperTrail has cached on a subject. This is a fast retrieval index, " +
      "not an LLM analysis.",
    method: "POST",
    path: "/api/retrieval/hybrid",
    inputSchema: obj(
      {
        query: str({ minLength: 1, maxLength: 1000, description: "The search query (1-1000 chars)." }),
        limit: int({ minimum: 1, maximum: 50, description: "Max hits to return (1-50)." }),
        expandGraph: bool({ description: "Expand results via knowledge-graph neighbors." }),
      },
      ["query"]
    ),
  },
  {
    name: "evidence_dossier",
    description:
      "Assemble a complete, verified, cited, trust-scored evidence dossier for a target, drug, disease, or claim " +
      "— PaperTrail's flagship. It composes the deterministic bio/evidence engines (genetic validation, " +
      "tractability, existing drugs, clinical trials, safety, mechanism, target-disease, claim verification); " +
      "Claude only PLANS which checks apply and NARRATES over the already-verified sections. Every load-bearing " +
      "number and the overall score/grade are DETERMINISTIC. " +
      "USE WHEN you want a one-shot, board-ready evidence package on an entity or claim (e.g. subjectType 'target', " +
      "subject 'PCSK9', disease 'hypercholesterolemia'). Runs many engines, so expect a wait; sections whose data " +
      "is unavailable are honestly omitted rather than faked.",
    method: "POST",
    path: "/api/dossier",
    inputSchema: obj(
      {
        subjectType: str({
          enum: ["target", "drug", "disease", "claim"],
          description: "What the subject is: target, drug, disease, or claim.",
        }),
        subject: str({
          minLength: 1,
          maxLength: 500,
          description: "The primary entity or claim text (1-500 chars).",
        }),
        disease: str({
          minLength: 1,
          maxLength: 300,
          description:
            "Optional disease context for association/efficacy checks (e.g. 'hypercholesterolemia').",
        }),
      },
      ["subjectType", "subject"]
    ),
  },
  {
    name: "real_world_evidence",
    description:
      "Compute deterministic real-world-evidence (RWE) temporal signals over the open corpus (FAERS, PubMed, " +
      "ClinicalTrials.gov) — the 'Aetion angle' on public data. Provide 'drug'+'event' for a per-year FAERS " +
      "disproportionality trend (PRR/IC, classified rising/stable/falling by a deterministic OLS slope), and/or " +
      "'topic' for a per-year publication + trial-start volume trend (classified emerging/active/established). " +
      "EVERY number is computed by a deterministic engine; NO LLM is in the numeric path, and unavailable signals " +
      "come back null (honest-empty), never fabricated. " +
      "USE WHEN you want to see how a safety signal or a research area is trending over time. At least 'topic', " +
      "or both 'drug' and 'event', are required.",
    method: "POST",
    path: "/api/rwe",
    inputSchema: obj({
      drug: str({
        minLength: 1,
        maxLength: 200,
        description: "Drug name for a FAERS adverse-event trend (needs 'event' too).",
      }),
      topic: str({
        minLength: 1,
        maxLength: 300,
        description: "Topic for a publication + trial-start volume trend.",
      }),
      event: str({
        minLength: 1,
        maxLength: 200,
        description: "Adverse event for the FAERS trend (needs 'drug' too).",
      }),
    }),
  },

  // === bioDomain.ts (biology domain layer: ontology + finding surface) ========
  {
    name: "verify_bioinformatics_finding",
    description:
      "Verify a structured bioinformatics finding (e.g. a scRNA-seq / signature claim) against the exact " +
      "source passage it is drawn from. Provide `assertion` (the claim, e.g. \"CD8 memory/exhausted ratio " +
      "stratifies ICB responders, AUC 0.86\"), the claimed `markerGenes` + `cellType`, the `effectSize`, the " +
      "study `population`, and `sourceText` (the verbatim results passage). Runs deterministic rule engines — " +
      "marker canonicalization vs curated panels, effect-size sanity (AUC in [0.5,1], CI contains the point " +
      "estimate, direction vs claimed benefit) — and grounds every quoted number to a VERBATIM substring of " +
      "sourceText; any number it cannot locate is DROPPED and counted. Returns a deterministic verdict " +
      "(supported | overstated | partially_supported | unsupported | insufficient_evidence), the per-check " +
      "`signals`, grounded `flagged_spans`, canonicalized markers, and `droppedUngrounded`. No LLM is in the " +
      "numeric/verdict path.",
    method: "POST",
    path: "/api/bio/verify-finding",
    inputSchema: obj(
      {
        assertion: str({ minLength: 1, maxLength: 2000, description: "The finding / claim to verify." }),
        markerGenes: arr(str({ minLength: 1, maxLength: 50 }), {
          description: "Claimed marker gene symbols, e.g. [\"IL7R\",\"TCF7\",\"CCR7\"].",
        }),
        cellType: str({ minLength: 1, maxLength: 200, description: "Claimed cell type, e.g. CD8 memory-like." }),
        effectSize: obj(
          {
            metric: str({ enum: ["AUC", "HR", "logFC"], description: "Effect-size metric." }),
            value: num({ description: "Point estimate." }),
            ci_lower: num({ description: "Optional 95% CI lower bound." }),
            ci_upper: num({ description: "Optional 95% CI upper bound." }),
          },
          ["metric", "value"]
        ),
        population: str({ minLength: 1, maxLength: 500, description: "Study population." }),
        sourceText: str({
          minLength: 1,
          maxLength: 200000,
          description: "The verbatim source passage every quoted number must appear in.",
        }),
      },
      ["assertion", "sourceText"]
    ),
  },
  {
    name: "check_marker_panel",
    description:
      "Check whether one or more genes are documented markers of a cell type against PaperTrail's curated " +
      "cell_marker_panels (CellMarker 2.0 / PanglaoDB, with direction + tissue + PMID). Provide `markerGenes` " +
      "(one or more symbols, e.g. [\"IL7R\",\"TCF7\"]) and `cellType` (label, e.g. \"CD8 memory-like\"). Each " +
      "gene is resolved to a canonical ontology term (deterministic, no LLM) and checked for registered " +
      "membership + direction; a gene that is not a marker, or is registered in the opposite direction, is " +
      "flagged as overstated. An unresolved gene or a cell type with no curated panel yields an honest empty " +
      "result — never a fabricated marker relationship.",
    method: "POST",
    path: "/api/bio/marker-check",
    inputSchema: obj(
      {
        markerGenes: arr(str({ minLength: 1, maxLength: 50 }), {
          description: "Claimed marker gene symbols, e.g. [\"IL7R\",\"TCF7\",\"CCR7\"].",
        }),
        cellType: str({ minLength: 1, maxLength: 200, description: "Cell-type label, e.g. CD8 memory-like." }),
      },
      ["markerGenes", "cellType"]
    ),
  },
  {
    name: "canonicalize_entity",
    description:
      "Resolve a free-text biomedical surface form to its canonical ontology term. Provide `surface` (the " +
      "term to resolve, e.g. \"HER2\" or \"heart attack\") and optionally `type` (a term-type filter to " +
      "disambiguate). The surface is normalized (lowercase, collapsed whitespace) and matched EXACTLY " +
      "against curated ontology synonyms — a hit returns the CURIE, canonical label, ontology, term type, a " +
      "score of 1.0, and cross-references (xrefs); a miss returns null. No LLM is in the entity-linking " +
      "path, and an unrecognized surface yields an honest null rather than a fabricated id. USE THIS to get " +
      "the exact ontology id + xrefs for an entity, or to normalize a term before querying an evidence " +
      "engine.",
    method: "POST",
    path: "/api/entities/canonicalize",
    inputSchema: obj(
      {
        surface: str({ minLength: 1, maxLength: 200, description: "The surface form to resolve, e.g. HER2." }),
        type: str({
          minLength: 1,
          maxLength: 64,
          description: "Optional term-type filter to disambiguate the match.",
        }),
      },
      ["surface"]
    ),
  },
  {
    name: "verify_variant_outcome",
    description:
      "Verify a claimed variant→outcome direction against ClinVar's registered clinical significance. " +
      "Provide at least one variant identifier — `rsId` (e.g. \"rs334\"), `hgvs`, or `gene` — optionally " +
      "narrowed by `condition`, plus the `claimedDirection` (\"protective\" or \"risk\"). Returns a " +
      "deterministic verdict on whether the claimed direction is consistent with the registered ClinVar " +
      "significance, with the supporting records. No LLM is in the verdict path; an empty upstream response " +
      "yields an honest not_found/insufficient result rather than a guess.",
    method: "POST",
    path: "/api/bio/variant-outcome",
    inputSchema: obj(
      {
        rsId: str({ minLength: 1, maxLength: 50, description: "Variant rsID, e.g. rs334." }),
        hgvs: str({ minLength: 1, maxLength: 200, description: "HGVS variant notation." }),
        gene: str({ minLength: 1, maxLength: 50, description: "Gene symbol to scope the locus." }),
        condition: str({ minLength: 1, maxLength: 200, description: "Optional condition/phenotype to scope." }),
        claimedDirection: str({
          enum: ["protective", "risk"],
          description: "Claimed clinical direction: protective (reduces risk) or risk (increases risk).",
        }),
      },
      ["claimedDirection"]
    ),
  },
];
