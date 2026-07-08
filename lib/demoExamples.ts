/**
 * Pinned one-click demo claims for the PaperTrail landing page.
 *
 * Claim strings are copied VERBATIM from tests/fixtures/demo-claims.json so the
 * landing-page demos exercise the exact same inputs the test suite validates.
 * Keep the ids and claim text in sync with that fixture.
 */

export interface DemoExample {
  id: string;
  label: string;
  claim: string;
  blurb: string;
}

export const DEMO_EXAMPLES: DemoExample[] = [
  {
    id: "demo-hero-catch-lecanemab",
    label: "Catch an overstatement",
    claim:
      "In the CLARITY-AD trial, lecanemab slowed cognitive decline by 27% and the drug caused brain swelling (ARIA-E edema) in 21.3% of patients.",
    blurb:
      "A lecanemab Alzheimer's claim that inflates the ARIA-E edema rate beyond what the CLARITY-AD abstract reports.",
  },
  {
    id: "demo-green-pass-sprint",
    label: "Confirm an accurate claim",
    claim:
      "In SPRINT, intensively lowering systolic blood pressure to below 120 mm Hg in adults at increased cardiovascular risk without diabetes reduced the primary composite cardiovascular outcome, with a hazard ratio of 0.75 versus a target below 140 mm Hg.",
    blurb:
      "A SPRINT blood-pressure claim stated precisely enough to match the source's own numbers and pass verification.",
  },
  {
    id: "demo-honest-abstention-sprint-mismatch",
    label: "See it abstain honestly",
    claim:
      "Dapagliflozin reduced the risk of worsening heart failure in patients with heart failure and a reduced ejection fraction, with a hazard ratio of 0.75.",
    blurb:
      "A heart-failure claim cited to the wrong source, where honest abstention beats a false match on a coincidental hazard ratio.",
  },
];
