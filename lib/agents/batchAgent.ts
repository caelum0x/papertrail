import { getPool } from "@/lib/db";
import { logEvent } from "@/lib/logger";
import { reconcile } from "@/lib/effectSize";
import { retrieveSource } from "@/lib/agents/retrievalAgent";
import { extractFinding } from "@/lib/agents/extractionAgent";
import { verifyClaim } from "@/lib/agents/verificationAgent";
import { BatchResultItem } from "@/components/BatchResults";

export interface RunBatchResult {
  batch_id: string;
  results: BatchResultItem[];
}

/**
 * Orchestrates a batch verification run over `claims` (the caller has already
 * applied MAX_BATCH capping and trimming). Persists a `batches` row up front,
 * runs the existing retrieveSource -> extractFinding -> verifyClaim -> reconcile
 * chain SEQUENTIALLY per claim, persists each verified result to `verifications`
 * tagged with the batch id, and marks the batch complete at the end.
 *
 * Isolation: each claim runs in its own try/catch so one failure never sinks the
 * batch, and each persistence runs in its own try/catch so a DB hiccup never
 * discards a result the user already paid for. Respects DEMO_MODE implicitly via
 * retrieveSource (cache-only misses return null -> "no_support_found").
 */
export async function runBatch(claims: string[]): Promise<RunBatchResult> {
  const pool = getPool();

  const { rows: batchRows } = await pool.query(
    `insert into batches (claim_count) values ($1) returning id`,
    [claims.length]
  );
  const batchId: string = batchRows[0].id;

  const results: BatchResultItem[] = [];

  // SEQUENTIAL processing (for-loop with await, NOT Promise.all): bounds concurrent
  // token spend to one agent chain at a time.
  for (const claim of claims) {
    try {
      const source = await retrieveSource(claim);

      // No confident source (under DEMO_MODE retrieval is cache-only, so misses land
      // here with zero extraction/verification spend) — record and move on.
      if (!source) {
        results.push({ claim, status: "no_support_found" });
        continue;
      }

      const finding = await extractFinding(source.id, source.raw_text);
      const verification = await verifyClaim({
        claim,
        finding,
        sourceRawText: source.raw_text,
      });
      const effectSizeCheck = reconcile(claim, source.raw_text);

      // Best-effort persistence, isolated per item.
      let verificationId: string | null = null;
      try {
        const { rows } = await pool.query(
          `insert into verifications (claim_text, matched_source_id, discrepancy_type, trust_score, explanation, flagged_spans, batch_id)
           values ($1, $2, $3, $4, $5, $6::jsonb, $7)
           returning id`,
          [
            claim,
            source.id,
            verification.discrepancy_type,
            verification.trust_score,
            verification.explanation,
            JSON.stringify(verification.flagged_spans),
            batchId,
          ]
        );
        verificationId = rows[0]?.id ?? null;
      } catch (persistErr) {
        logEvent("batch.persist_error", { error: String(persistErr) });
        console.error("[batchAgent] persistence failed (result still returned):", persistErr);
      }

      results.push({
        claim,
        status: "verified",
        verification_id: verificationId,
        source: {
          title: source.title,
          url: source.url,
          source_type: source.source_type,
          external_id: source.external_id,
          raw_text: source.raw_text,
        },
        verification,
        effect_size_check: effectSizeCheck,
      });
    } catch (err) {
      // Isolate each claim: one failure must not sink the whole batch.
      logEvent("batch.item_error", { error: String(err) });
      console.error("[batchAgent] claim failed:", err);
      results.push({ claim, status: "error" });
    }
  }

  // Mark the batch complete. Isolated so a status-update hiccup never discards the
  // results the caller already assembled.
  try {
    await pool.query(
      `update batches set status = 'complete', completed_at = now() where id = $1`,
      [batchId]
    );
  } catch (statusErr) {
    logEvent("batch.status_error", { error: String(statusErr) });
    console.error("[batchAgent] batch status update failed:", statusErr);
  }

  return { batch_id: batchId, results };
}
