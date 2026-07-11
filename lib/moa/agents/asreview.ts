// PaperTrail MoA v2 — ASReview ENSEMBLE SCREENING agent (category: screening).
//
// COMPOSITION ROLE: ASReview is a TRIAGE/RANKING engine, not a claim-verifier and not an
// enricher of the claim pipeline. It PRODUCES no artifact and CONSUMES no artifact — it does
// not participate in the claim-verification DAG at all. Its job is orthogonal to the artifact
// taxonomy: given a set of human-LABELED abstracts and a SEPARATE pool of UNLABELED abstracts,
// it ranks the unlabeled pool by screening priority (include / quality / risk-of-bias) so a
// reviewer works the highest-priority abstracts first (lib/screening/ensemble.ts::ensembleScreen).
//
// PRODUCES: []  — it writes nothing back to the blackboard (its output is a ranking, not a
//   verification signal that composes with entities/labels/effect_sizes/etc.).
// CONSUMES: [] — it reads no upstream artifact; a screening set is a wholly separate input,
//   attached to the context by a screening orchestrator, never derived from claim sources.
//   With empty consumes it is layer-independent — the scheduler can place it in the first layer.
//
// WHY IT USUALLY SKIPS ON THE CLAIM PATH: screening needs TWO things the plain claim+sources
// context does not carry — (1) abstracts each with a BINARY include (+ optional quality / rob)
// decision, and (2) a SEPARATE unlabeled pool to rank. A MoaSource only carries a
// SUPPORTS/REFUTES/NEI verification `label`, a different axis entirely, and the claim path
// provides no labeled/unlabeled split. So gate() returns 0 on the claim path and ASReview
// never runs — the honest Mixture-of-Experts answer for a triage engine with nothing to triage.
// It stays REGISTERED so that when a screening orchestrator DOES attach a well-formed screening
// set to the context, gate() detects it, gates in, and run() calls ensembleScreen.
//
// MOAT / DETERMINISM: the whole run() path is a single call into the pure, LLM-free
// ensembleScreen() — no network, no DB pool, no Claude. usedClaude is always false. No number,
// rank, or priority is ever LLM-decided; groundedSpans stays empty (the engine emits no quotes,
// so we fabricate none).
//
// This UPGRADES backend/moa-v1-adapters/asreview.ts to the v2 composition contract: same engine
// call and same deterministic detection, now expressed as a MoaAgent with produces/consumes and
// a (ctx, bb) run signature. The blackboard is unused here by design — ASReview neither reads nor
// writes artifacts — which is itself an honest statement of its place in the composition.

import type {
  MoaAgent,
  OrchestrationContext,
  AgentContribution,
  Blackboard,
} from "../types";
import {
  makeContribution,
  skippedContribution,
  erroredContribution,
  clamp01,
} from "../types";
import {
  ensembleScreen,
  type LabeledAbstract,
  type UnlabeledAbstract,
  type EnsembleResult,
} from "../../screening/ensemble";

const AGENT_ID = "asreview";

// A screening job needs at least this many labeled abstracts to give any axis a chance at
// two-class signal, and at least one unlabeled abstract to actually rank. Below this the
// engine has nothing meaningful to do.
const MIN_LABELED = 2;
const MIN_UNLABELED = 1;

// Gate weight when a well-formed screening set is actually present on the context. High,
// because ensemble screening is exactly what ASReview is for. On the plain claim path no
// such set exists, so gate() returns 0 (never runs) — correct Mixture-of-Experts triage.
const GATE_ACTIVE = 0.9;

// One safe UI line for the honest skip on the claim path (exact wording from the spec).
const SKIP_REASON =
  "screening needs a labeled/unlabeled abstract set — run via Screening";

// ---------------------------------------------------------------------------
// Screening-set detection.
//
// The base OrchestrationContext does not model a screening set (it carries a claim, a source
// list, and options). A screening orchestrator that wants ASReview to participate can attach
// one under the reserved `screening` key. We detect it structurally and defensively — never
// trusting the shape — and treat it as absent whenever it is missing or malformed.
// ---------------------------------------------------------------------------

// The optional carrier an orchestrator may attach to the context to request a screen.
interface ScreeningSet {
  labeled: readonly LabeledAbstract[];
  unlabeled: readonly UnlabeledAbstract[];
}

// A context that MAY carry a screening set. We read it through this widened view rather than
// mutating or re-typing the shared OrchestrationContext.
type MaybeScreeningContext = OrchestrationContext & {
  screening?: unknown;
};

function isFlag01(value: unknown): value is 0 | 1 {
  return value === 0 || value === 1;
}

function isLabeledAbstract(value: unknown): value is LabeledAbstract {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.text !== "string" || v.text.length === 0) return false;
  if (!isFlag01(v.include)) return false;
  if (v.quality !== undefined && !isFlag01(v.quality)) return false;
  if (v.rob !== undefined && !isFlag01(v.rob)) return false;
  return true;
}

function isUnlabeledAbstract(value: unknown): value is UnlabeledAbstract {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    v.id.length > 0 &&
    typeof v.text === "string" &&
    v.text.length > 0
  );
}

// Pure, side-effect-free extraction of a VALID screening set from the context, or null. Safe
// for the gate to call on every request. Returns a set only when both arrays are present,
// well-formed, and large enough for the engine to have real work to do.
function extractScreeningSet(ctx: OrchestrationContext): ScreeningSet | null {
  const candidate = (ctx as MaybeScreeningContext).screening;
  if (typeof candidate !== "object" || candidate === null) return null;

  const c = candidate as Record<string, unknown>;
  if (!Array.isArray(c.labeled) || !Array.isArray(c.unlabeled)) return null;

  if (!c.labeled.every(isLabeledAbstract)) return null;
  if (!c.unlabeled.every(isUnlabeledAbstract)) return null;

  const labeled = c.labeled as LabeledAbstract[];
  const unlabeled = c.unlabeled as UnlabeledAbstract[];

  if (labeled.length < MIN_LABELED || unlabeled.length < MIN_UNLABELED) {
    return null;
  }

  return { labeled, unlabeled };
}

// Confidence for a screening contribution: how decisively the engine separated the pool. We
// use the top-ranked abstract's priority (already in [0,1]) — a high top priority means the
// classifiers found strong include/quality/low-RoB signal; an empty ranking (no axis trained)
// yields 0. Pure read of a deterministic engine output.
function confidenceFromResult(result: EnsembleResult): number {
  const top = result.ranking[0];
  return top ? clamp01(top.priority) : 0;
}

const agent: MoaAgent = {
  id: AGENT_ID,
  name: "ASReview Ensemble Screener",
  category: "screening",
  description:
    "Deterministic TF-IDF + Naive Bayes ensemble that ranks unlabeled abstracts by " +
    "include/quality/risk-of-bias priority learned from labeled abstracts. Runs only when a " +
    "labeled/unlabeled screening set is attached to the context; otherwise skips (not a claim vote).",

  // Triage engine: it produces no verification artifact and consumes none. Empty on both sides
  // keeps it out of the claim DAG's data dependencies while staying registered and dispatchable.
  produces: [] as const,
  consumes: [] as const,

  // DETERMINISTIC gate over the INPUT only (never the blackboard — gate runs before scheduling).
  // High only when the context actually carries a well-formed screening set; 0 otherwise. On the
  // ordinary claim path there is no such set, so this returns 0 and ASReview never runs — the
  // honest Mixture-of-Experts answer for a triage engine that has nothing to triage. Pure, no
  // I/O, no LLM, never throws.
  gate(ctx: OrchestrationContext): number {
    return extractScreeningSet(ctx) !== null ? GATE_ACTIVE : 0;
  },

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async run(ctx: OrchestrationContext, _bb: Blackboard): Promise<AgentContribution> {
    // COMPOSITION NOTE: `_bb` is intentionally unused. ASReview reads no upstream artifact
    // (consumes: []) and writes none (produces: []) — its input is a separate screening set on
    // the context, not blackboard artifacts. Touching the blackboard here would be dishonest.
    try {
      const set = extractScreeningSet(ctx);

      // Honest runtime skip: the claim path (or any context without a valid screening set) has
      // no labeled/unlabeled abstracts to rank. Not an error — just not this engine's job here.
      if (set === null) {
        return skippedContribution(AGENT_ID, SKIP_REASON);
      }

      const result = ensembleScreen(set.labeled, set.unlabeled);

      // No axis had two-class signal (or no usable tokens): the engine honestly produced no
      // ranking. Skip rather than fabricate an order.
      if (result.ranking.length === 0) {
        return skippedContribution(
          AGENT_ID,
          "No screening axis had enough two-class signal to rank the abstract pool."
        );
      }

      const top = result.ranking[0];
      const confidence = confidenceFromResult(result);

      // Detail = ids/counts/scores only — never abstract text (mirrors the no-text logging
      // discipline). The ranking is capped to keep the payload compact.
      const detail: Record<string, unknown> = {
        labeled: result.meta.labeled,
        unlabeled: result.meta.unlabeled,
        vocabularySize: result.meta.vocabularySize,
        axesTrained: result.meta.axesTrained,
        rankedCount: result.ranking.length,
        topId: top.id,
        topPriority: top.priority,
        topDecidingAxis: top.decidingAxis,
        ranking: result.ranking.slice(0, 25).map((score) => ({
          id: score.id,
          priority: score.priority,
          decidingAxis: score.decidingAxis,
          includeScore: score.includeScore,
          qualityScore: score.qualityScore,
          robScore: score.robScore,
        })),
      };

      // Screening is triage, not verification: it ranks WHICH abstracts to read, it does not
      // vote for/against the claim. So the directional signal is `neutral` (context / weighting),
      // never supports/refutes. groundedSpans stays empty — the engine emits no verbatim quotes,
      // so we fabricate none. produced stays empty — nothing composes downstream.
      return makeContribution(AGENT_ID, {
        ran: true,
        signal: "neutral",
        confidence,
        summary:
          `Ranked ${result.ranking.length} unlabeled abstract(s) by screening priority; ` +
          `top priority ${top.priority.toFixed(2)} (${top.decidingAxis} axis).`,
        detail,
        groundedSpans: [],
        usedClaude: false,
        produced: {},
      });
    } catch (err) {
      return erroredContribution(AGENT_ID, err);
    }
  },
};

export default agent;
