// CLIENT-SIDE demo example for the CLINICAL TRIAL MATCHER.
//
// Blocker fix: a first-time coordinator should get value in ONE CLICK without typing or any DB
// seeding. This constant is a realistic, DE-IDENTIFIED oncology vignette that exercises the
// full pipeline (age/sex, condition, biomarker, prior treatment, performance status, labs,
// plus a deliberately UNSTATED criterion so the "cannot determine from note" path is visible).
//
// It contains NO identifiers by construction — no name, MRN, DOB, address, or contact — the
// same contract the tool enforces on real input. It is shipped to the browser as a plain
// string; loading it just fills the textarea and runs a normal match (no special-casing).

// A HER2+ metastatic breast cancer vignette — the canonical demo patient. Rich enough to
// produce several inclusion "met" chips and at least one honest "unknown" (liver function /
// brain metastasis status are intentionally not stated), so the reasoning breakdown is
// meaningful rather than all-green.
export const EXAMPLE_PATIENT_NOTES = [
  "62-year-old female with HER2-positive metastatic breast cancer.",
  "Initially diagnosed with stage II disease; now with biopsy-confirmed metastatic recurrence to bone and lung.",
  "ER positive, PR negative, HER2 3+ by IHC and amplified by FISH.",
  "Prior systemic therapy: trastuzumab plus pertuzumab with a taxane, then trastuzumab emtansine (T-DM1) on progression.",
  "ECOG performance status 1.",
  "Recent labs: eGFR 78 mL/min/1.73m2, ANC 3.1, platelets 190, hemoglobin 11.8.",
  "No prior treatment with a tyrosine kinase inhibitor.",
  "Postmenopausal. Adequate cardiac function, LVEF 58% on recent echocardiogram.",
].join(" ");

// A short, human label for the "Try an example" affordance so the coordinator knows what
// they are about to load before clicking.
export const EXAMPLE_PATIENT_LABEL =
  "62F · HER2+ metastatic breast cancer · ECOG 1 · prior trastuzumab/T-DM1";
