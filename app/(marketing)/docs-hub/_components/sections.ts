import type { DocSection } from "./types";

export const SECTIONS: readonly DocSection[] = [
  {
    heading: "Getting started",
    links: [
      {
        title: "What PaperTrail is",
        description:
          "The problem, who it's for, and the deliberately narrow scope of the tool.",
        href: "/product",
        internal: true,
      },
      {
        title: "How verification works",
        description:
          "The three-stage retrieval, extraction, and verification pipeline in detail.",
        href: "/about",
        internal: true,
      },
    ],
  },
  {
    heading: "Using the tool",
    links: [
      {
        title: "Verify a claim",
        description:
          "Paste a clinical-trial efficacy claim and get a discrepancy verdict, trust score, and flagged spans.",
        href: "/",
        internal: true,
      },
      {
        title: "Reading a result",
        description:
          "How to interpret the discrepancy taxonomy, the trust score, and each exact-span flag.",
        href: "/about#taxonomy",
        internal: true,
      },
    ],
  },
  {
    heading: "Trust & access",
    links: [
      {
        title: "Security & trust center",
        description:
          "Deterministic verification, code-enforced provenance, RBAC, and the audit trail.",
        href: "/security",
        internal: true,
      },
      {
        title: "Public trust API",
        description:
          "GET /api/trust/summary — capability list and build info, no tenant data, no auth.",
        href: "/api/trust/summary",
        internal: true,
      },
    ],
  },
] as const;
