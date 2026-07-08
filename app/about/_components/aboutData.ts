// Content data for the About page, separated from presentation so each section
// component stays a thin, testable renderer.

export interface PipelineStage {
  stage: string;
  title: string;
  body: string;
}

export interface TaxonomyEntry {
  type: string;
  label: string;
  description: string;
}

export interface Limitation {
  title: string;
  body: string;
}

export const PIPELINE_STAGES: readonly PipelineStage[] = [
  {
    stage: "Stage 1",
    title: "Retrieval",
    body: "The claim is embedded with Voyage AI and matched against cached source records using pgvector similarity search. Sources fetched from PubMed or ClinicalTrials.gov are cached on first retrieval and never re-fetched. If no candidate clears the confidence threshold, retrieval abstains and returns no_support_found rather than forcing a match.",
  },
  {
    stage: "Stage 2",
    title: "Extraction",
    body: "Claude reads the matched source and extracts a structured finding — effect size, population, condition, endpoint, caveats. Output is validated against a strict schema before use; raw model JSON is never trusted. Findings are cached per source, so a paper is read once.",
  },
  {
    stage: "Stage 3",
    title: "Verification",
    body: "Claude compares the claim to the extracted finding and source, producing a discrepancy classification, trust score, explanation, and flagged spans. This is paired with a deterministic effect-size and registered-results cross-check that recomputes the trial's own numbers — a result that cannot wobble on resubmission and honestly defers when no numeric estimate exists.",
  },
];

export const TAXONOMY: readonly TaxonomyEntry[] = [
  { type: "accurate", label: "Accurate", description: "The claim faithfully represents the source's finding — right magnitude, population, and caveats. PaperTrail passes these cleanly, it does not flag everything." },
  { type: "magnitude_overstated", label: "Magnitude overstated", description: "The claimed effect is larger than the source reports — a relative reduction quoted as absolute, a rounded-up percentage, or a benefit stated more strongly than the estimate supports." },
  { type: "population_overgeneralized", label: "Population overgeneralized", description: "A finding shown in a specific population or subgroup is restated as if it applies more broadly than the trial established." },
  { type: "caveat_dropped", label: "Caveat dropped", description: "A material qualifier is missing from the claim — a safety signal, a confidence interval crossing null, or a limitation that changes how the result should be read." },
  { type: "no_support_found", label: "No support found", description: "Retrieval could not confidently match the claim to a primary source. PaperTrail returns this honest result rather than forcing a low-confidence match." },
];

export const LIMITATIONS: readonly Limitation[] = [
  { title: "One claim at a time, or a capped batch.", body: "It verifies a single claim per submission (or a bounded number of split sub-claims), not an entire 50-citation review in one pass." },
  { title: "Abstract and registered results as primary text.", body: "Extraction works from abstract/results text and the structured registry; the enterprise document pipeline adds full-PDF extraction on top." },
  { title: "Clinical-trial efficacy claims.", body: "It is not a general-purpose fact-checker for arbitrary or non-biomedical statements." },
  { title: "PubMed + ClinicalTrials.gov.", body: "The verification core searches these two — not preprint servers or press releases." },
];
