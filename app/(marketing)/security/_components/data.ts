import type { Pillar } from "./types";

export const PILLARS: readonly Pillar[] = [
  {
    id: "deterministic-verification",
    title: "Deterministic verification (the moat)",
    body:
      "A language model can be asked to check a claim, but its answer can drift between runs. PaperTrail pairs the model's verdict with a deterministic effect-size cross-check written in code.",
    points: [
      "Reported estimates and confidence intervals (RR, HR, OR, RRR) are parsed and checked against fixed statistical rules.",
      "Because the check is deterministic, its result cannot be made to wobble by resubmitting the same claim.",
      "Where a claim has no parseable numeric estimate, the cross-check honestly defers rather than inventing one.",
    ],
  },
  {
    id: "provenance",
    title: "Code-enforced provenance",
    body:
      "The verification model is asked to quote the source exactly, but nothing about a model response guarantees the quotes are real. PaperTrail turns that expectation into a code-enforced invariant.",
    points: [
      "Every flagged source span is located inside the cached source text before it is ever shown.",
      "Matching is exact-substring first, then whitespace-normalized, always recovering the verbatim original text and its offsets.",
      "Any span that cannot be located in the source is dropped — so the tool structurally cannot make an unsourced claim about a source.",
    ],
  },
  {
    id: "rbac",
    title: "Role-based access control",
    body:
      "Access is scoped by organization and role. Every authenticated route resolves the caller's org membership before doing any work.",
    points: [
      "Four roles: owner, admin, editor, viewer, each with an explicit capability set.",
      "Routes enforce a minimum required role and reject anything below it with a 403.",
      "All tenant data is filtered by organization at the query level — no cross-tenant reads.",
    ],
  },
  {
    id: "audit",
    title: "Tamper-evident audit trail",
    body:
      "Every mutation is recorded so that a reviewer can reconstruct exactly what happened and detect any after-the-fact change.",
    points: [
      "Mutations write an audit record capturing the actor, action, entity, and metadata.",
      "The audit ledger is append-only and hash-chained: each entry binds to the previous one.",
      "Altering a past event breaks every subsequent hash, making tampering detectable.",
    ],
  },
] as const;

export const DATA_HANDLING: readonly string[] = [
  "Sources fetched from PubMed and ClinicalTrials.gov are cached and never re-fetched on every request.",
  "Secrets live in environment variables, never in source; required keys are checked at startup.",
  "Claim text and API keys are kept out of application logs.",
  "The public trust summary endpoint exposes only capability and build metadata — never tenant data.",
] as const;
