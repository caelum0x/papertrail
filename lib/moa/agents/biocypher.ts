// PaperTrail MoA v2 — BioCypher BYO-KG importer (category: bio-kg).
//
// COMPOSITION ROLE: NONE on the stateless claim path — BioCypher is an INGESTION tool, not a
// verifier or enricher. A lab uploads its own nodes/edges CSVs; each node is pinned to a
// Biolink category and every edge is validated against the Biolink slot domain/range before
// being written into the shared kg_nodes / kg_edges tables (see lib/kg/byoKg.ts). Its public
// entry point — validateAndImportKg(pool, orgId, { nodes, edges }) — fundamentally needs TWO
// things the MoA claim path never supplies:
//   1. A live DB pool (KgPool) to upsert nodes/edges and record the kg_import_batches audit row.
//   2. Structured nodes/edges CSVs; a plain claim + prose sources carry no such vocabulary.
//
// MoA orchestration is STATELESS (no pool) and the OrchestrationContext carries only
// { claim, sources, options }. There is nothing for BioCypher to import and no pool to write
// to. The honest Mixture-of-Agents behavior is therefore to gate 0 and, if ever invoked,
// return a skippedContribution explaining how to actually invoke this tool via the Knowledge
// Graph import endpoint. This registers BioCypher as a first-class agent WITHOUT ever opening
// a DB pool, touching the network, or fabricating an import/vote.
//
// COMPOSITION CONTRACT: produces [] and consumes [] — it is a leaf with no data dependencies,
// so the scheduler places it in layer 0 and it neither reads nor writes the blackboard. We DO
// NOT run Claude here (usedClaude: false). The one deterministic thing we surface for the trace
// is a PURE Biolink self-audit over the closed predicate vocabulary — reusing the already-
// exported, I/O-free lib/kg/biolink.ts helpers — so the detail panel shows this agent's typing
// capability even though it never votes and never grounds a span.

import type {
  MoaAgent,
  OrchestrationContext,
  AgentContribution,
  Blackboard,
} from "../types";
import { makeContribution, skippedContribution } from "../types";
import { isWellTypedTriple, toBiolinkPredicate } from "../../kg/biolink";
import { KG_PREDICATES } from "../../kg/schemas";

const AGENT_ID = "biocypher";

// One-line skip reason surfaced verbatim in the UI trace, per this engine's adapter contract.
const SKIP_REASON =
  "KG import tool — supply nodes/edges via Knowledge Graph import (POST /api/kg/import).";

// A pure, deterministic summary of the Biolink typing capability BioCypher enforces on import.
// This reads ONLY the compile-time closed vocabulary via the I/O-free biolink helpers — no DB,
// no network, no LLM, no claim/source data. It exists so the detail panel can show what this
// agent WOULD enforce, without implying it voted on the claim.
function biolinkTypingProfile(): {
  predicates: readonly string[];
  wellTypedProbe: boolean;
} {
  // Probe one canonical well-typed triple (drug -targets-> gene) to demonstrate the Biolink
  // domain/range check is live and deterministic. Uses our own closed entity vocabulary strings.
  const wellTypedProbe = isWellTypedTriple("drug", "targets", "gene");
  const predicates = KG_PREDICATES.map((p) => toBiolinkPredicate(p) ?? p);
  return { predicates, wellTypedProbe };
}

const agent: MoaAgent = {
  id: AGENT_ID,
  name: "BioCypher KG importer",
  category: "bio-kg",
  description:
    "Bring-your-own-KG import with Biolink typing: pins each uploaded node to a Biolink " +
    "category and rejects any edge that violates the Biolink slot domain/range. An ingestion " +
    "tool requiring nodes/edges CSVs and a DB pool — it does not verify claims, so it gates 0 " +
    "on the claim path and defers to the Knowledge Graph import endpoint.",

  // Produces/consumes nothing: this is an ingestion leaf, not a blackboard participant. It does
  // not enrich upstream and no downstream agent depends on it.
  produces: [] as const,
  consumes: [] as const,

  // Pure + deterministic + side-effect-free. BioCypher needs a DB pool and structured
  // nodes/edges CSVs that a plain claim never carries; the correct MoA decision is to never run
  // it in the stateless claim path. Gate 0 honestly — it can never be planner-boosted into
  // running, which is exactly right for an ingestion-only tool. No blackboard read, no I/O,
  // no LLM, no throwing.
  gate(_ctx: OrchestrationContext): number {
    return 0;
  },

  // gate is always 0, so the scheduler never selects this agent. If it is ever invoked directly,
  // return an honest skip — no DB pool is opened, no network call is made, Claude is not invoked,
  // and the blackboard is neither read nor written. We attach a deterministic, JSON-serializable,
  // non-secret Biolink typing profile so the trace still reflects this agent's capability without
  // fabricating any vote or grounded span. ran:false / signal:insufficient / confidence:0 /
  // usedClaude:false are preserved from the base skip.
  async run(_ctx: OrchestrationContext, _bb: Blackboard): Promise<AgentContribution> {
    const profile = biolinkTypingProfile();
    const skipped = skippedContribution(AGENT_ID, SKIP_REASON);
    return makeContribution(AGENT_ID, {
      ran: skipped.ran,
      signal: skipped.signal,
      confidence: skipped.confidence,
      summary: skipped.summary,
      usedClaude: false,
      groundedSpans: [],
      produced: {},
      detail: {
        reason: "ingestion-only",
        requiresPool: true,
        requiresNodeEdgeCsvs: true,
        importEndpoint: "/api/kg/import",
        biolinkPredicates: profile.predicates,
        biolinkTypingLive: profile.wellTypedProbe,
      },
    });
  },
};

export default agent;
