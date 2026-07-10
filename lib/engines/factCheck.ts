// Supplementary entailment fact-check layer, built on the opt-in MiniCheck bridge
// (lib/engines/minicheck.ts). This is DELIBERATELY additive: it complements the
// deterministic verbatim-span grounding in lib/grounding.ts. Grounding proves a
// quote is an exact substring of the source; MiniCheck judges whether a
// *paraphrased* claim is actually entailed (supported) by a grounding document.
//
// Contract: when MiniCheck is disabled (default) OR the subprocess bridge rejects
// for ANY reason, this returns `null` so callers treat the absence as "not checked"
// and fall back to their existing grounding-only behavior. It NEVER throws to the
// caller and NEVER logs claim/doc text (the bridge passes text only over stdin).

import {
  factCheck as runMiniCheck,
  isMiniCheckEnabled,
  type MiniCheckPair,
} from "@/lib/engines/minicheck";

/** One (claim, doc) pair to entailment-check: is `claim` supported by `doc`? */
export interface FactCheckPair {
  claim: string;
  doc: string;
}

/** Per-claim entailment verdict, surfaced alongside (not replacing) grounding. */
export interface FactCheckVerdict {
  claim: string;
  /** True when the claim is entailed (supported) by its document. */
  supported: boolean;
  /** Probability of "supported" for the decisive chunk, 0..1. */
  score: number;
}

export interface FactCheckResult {
  results: FactCheckVerdict[];
}

/**
 * Entailment-check claim/doc pairs via MiniCheck, when it is enabled.
 *
 * Returns the per-claim verdicts on success, or `null` when MiniCheck is
 * disabled or the bridge rejects — the caller MUST treat `null` as "not
 * checked" and keep its existing (grounding-based) behavior unchanged.
 * Empty input short-circuits to an empty result set (still "checked").
 */
export async function checkClaimsSupported(
  pairs: FactCheckPair[]
): Promise<FactCheckResult | null> {
  if (!isMiniCheckEnabled()) {
    return null;
  }
  if (!Array.isArray(pairs) || pairs.length === 0) {
    return { results: [] };
  }

  const bridgePairs: MiniCheckPair[] = pairs.map((p) => ({
    claim: p.claim,
    doc: p.doc,
  }));

  try {
    const out = await runMiniCheck({ pairs: bridgePairs });
    // Bridge already guarantees `ok` and an array on resolve, but re-narrow the
    // shape defensively so a malformed verdict can never propagate downstream.
    const results: FactCheckVerdict[] = out.results.map((v) => ({
      claim: v.claim,
      supported: Boolean(v.supported),
      score: typeof v.score === "number" ? v.score : 0,
    }));
    return { results };
  } catch {
    // Any rejection => "not checked". Do not log claim/doc text.
    return null;
  }
}
