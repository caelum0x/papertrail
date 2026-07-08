import type { Tier } from "./types";

export const TIERS: readonly Tier[] = [
  {
    name: "Researcher",
    price: "Free",
    cadence: "",
    tagline: "For individuals verifying their own claims.",
    features: [
      "Single-claim verification",
      "PubMed & ClinicalTrials.gov retrieval",
      "Exact-span provenance on every flag",
      "Cached sources shared across your workspace",
    ],
    cta: "Start verifying",
  },
  {
    name: "Lab",
    price: "Contact us",
    cadence: "",
    tagline: "For a team sharing a source library and review workflow.",
    features: [
      "Everything in Researcher",
      "Shared projects and review assignments",
      "Role-based access (owner, admin, editor, viewer)",
      "Tamper-evident audit trail",
    ],
    cta: "Talk to us",
    highlighted: true,
  },
  {
    name: "Organization",
    price: "Contact us",
    cadence: "",
    tagline: "For groups with compliance and reporting requirements.",
    features: [
      "Everything in Lab",
      "Tenant isolation and per-org feature flags",
      "Exportable reports and citation trails",
      "Priority support",
    ],
    cta: "Talk to us",
  },
] as const;
