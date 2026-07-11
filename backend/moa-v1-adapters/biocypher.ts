// MoA expert adapter — BioCypher (category: bio-kg). BioCypher is a bring-your-own-KG
// INGESTION tool: a lab uploads its own nodes/edges CSVs, each node is pinned to a Biolink
// category, and every edge is validated against the Biolink slot domain/range before being
// written into the shared kg_nodes / kg_edges tables (see lib/kg/byoKg.ts).
//
// That public entry point — validateAndImportKg(pool, orgId, { nodes, edges }) — fundamentally
// needs TWO things the claim path never supplies:
//   1. A live DB pool (KgPool) to upsert nodes/edges and record the kg_import_batches audit row.
//   2. Structured nodes/edges CSVs; a plain claim + prose sources carry no such vocabulary.
//
// MoA orchestration is STATELESS (no pool) and the input is a claim, not a KG import request.
// The honest Mixture-of-Experts behavior is therefore to gate 0 on the claim path and return a
// skippedContribution explaining how to actually invoke this tool — this registers BioCypher as
// an expert without ever opening a DB pool or fabricating an import.
//
// We do NOT run Claude and do NOT touch the network or a pool here. The one deterministic thing
// we can surface for the detail panel is a PURE Biolink self-audit over the closed predicate
// vocabulary (reusing the already-exported, I/O-free lib/kg/biolink.ts helpers), so the trace
// shows this expert's typing capability even though it does not vote.

import type { Expert, OrchestrationContext, ExpertContribution } from "../types";
import { skippedContribution, makeContribution } from "../types";
import {
  isWellTypedTriple,
  toBiolinkPredicate,
} from "../../kg/biolink";
import { KG_PREDICATES } from "../../kg/schemas";

const EXPERT_ID = "biocypher";

// One-line skip reason surfaced in the UI trace, per the adapter contract for this engine.
const SKIP_REASON =
  "KG import tool — supply nodes/edges via Knowledge Graph import (POST /api/kg/import).";

// A pure, deterministic summary of the Biolink typing capability BioCypher enforces on import.
// This reads ONLY the compile-time closed vocabulary via the I/O-free biolink helpers — no DB,
// no network, no LLM, no claim/source data. It exists so the detail panel can show what this
// expert *would* enforce, without implying it voted on the claim.
function biolinkTypingProfile(): {
  predicates: readonly string[];
  wellTypedProbe: boolean;
} {
  // Probe one canonical well-typed triple (drug -targets-> gene) to demonstrate the domain/range
  // check is live and deterministic. Uses our own closed entity vocabulary strings.
  const wellTypedProbe = isWellTypedTriple("drug", "targets", "gene");
  const predicates = KG_PREDICATES.map(
    (p) => toBiolinkPredicate(p) ?? p
  );
  return { predicates, wellTypedProbe };
}

const expert: Expert = {
  id: EXPERT_ID,
  name: "BioCypher KG importer",
  category: "bio-kg",
  description:
    "Bring-your-own-KG import with Biolink typing: pins each uploaded node to a Biolink " +
    "category and rejects any edge that violates the Biolink slot domain/range. An ingestion " +
    "tool requiring nodes/edges CSVs and a DB pool — it does not verify claims, so it gates 0 " +
    "on the claim path and defers to the Knowledge Graph import endpoint.",

  // Pure + deterministic + side-effect-free. BioCypher needs a DB pool and structured
  // nodes/edges CSVs that a plain claim never carries; the correct MoE decision is to never run
  // it in the stateless claim path. Gate 0 honestly — it can never be planner-boosted into
  // running, which is exactly right for an ingestion-only tool.
  gate(_ctx: OrchestrationContext): number {
    return 0;
  },

  // Never invoked at a threshold > 0 in practice (gate is 0), but the interface requires run().
  // We return an honest skip — no DB pool is opened, no network call is made, Claude is not
  // invoked. We attach a deterministic Biolink typing profile so the trace still reflects this
  // expert's capability without fabricating any vote or grounded span.
  async run(_ctx: OrchestrationContext): Promise<ExpertContribution> {
    const profile = biolinkTypingProfile();
    const skipped = skippedContribution(EXPERT_ID, SKIP_REASON);
    // Enrich the honest skip with a JSON-serializable, non-secret detail payload. This keeps
    // ran:false / signal:insufficient / confidence:0 / usedClaude:false intact.
    return makeContribution(EXPERT_ID, {
      ran: skipped.ran,
      signal: skipped.signal,
      confidence: skipped.confidence,
      summary: skipped.summary,
      usedClaude: false,
      groundedSpans: [],
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

export default expert;
