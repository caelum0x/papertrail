import type { Release } from "./types";

// Entries describe capabilities that exist in this codebase — no fabricated
// metrics or dates. Ordered newest first.
export const RELEASES: readonly Release[] = [
  {
    version: "Trust center",
    focus: "Public marketing, docs, and a trust API",
    changes: [
      {
        title: "Security & trust center",
        tag: "New",
        description:
          "A public page documenting deterministic verification, code-enforced provenance, RBAC, and the tamper-evident audit trail.",
      },
      {
        title: "Public trust summary API",
        tag: "New",
        description:
          "GET /api/trust/summary returns a high-level capability list and build info with no tenant data and no auth required.",
      },
      {
        title: "Product, pricing, and docs pages",
        tag: "New",
        description:
          "Static public pages describing what PaperTrail does, how it is priced, and where to find documentation.",
      },
    ],
  },
  {
    version: "Verification core",
    focus: "The claim-to-source verification pipeline",
    changes: [
      {
        title: "Three-stage pipeline",
        tag: "New",
        description:
          "Retrieval, extraction, and verification agents run in sequence, each caching its work so shared sources are never recomputed.",
      },
      {
        title: "Deterministic effect-size cross-check",
        tag: "Improved",
        description:
          "The model's verdict is paired with a code-level check over parsed estimates and confidence intervals, so results cannot wobble between runs.",
      },
      {
        title: "Grounding invariant",
        tag: "Security",
        description:
          "Flagged spans that cannot be located in the cached source text are dropped, enforced in code and covered by tests.",
      },
    ],
  },
  {
    version: "Platform",
    focus: "Multi-tenant access and accountability",
    changes: [
      {
        title: "Role-based access control",
        tag: "Security",
        description:
          "Owner, admin, editor, and viewer roles gate every authenticated route, with org-scoped data access throughout.",
      },
      {
        title: "Tamper-evident audit trail",
        tag: "Security",
        description:
          "Mutations write to an append-only, hash-chained audit ledger so past events cannot be silently altered.",
      },
    ],
  },
] as const;
