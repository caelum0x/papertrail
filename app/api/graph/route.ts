import { NextRequest } from "next/server";
import { z } from "zod";
import { getPool } from "@/lib/db";
import { ok, fail } from "@/lib/api/response";
import { checkRateLimit } from "@/lib/rateLimit";
import { logEvent } from "@/lib/logger";
import { sanitizeClaimText } from "@/lib/api/claimInput";
import { extractGraphFromSource } from "@/lib/graph/extract";
import { buildEvidenceGraph } from "@/lib/graph/build";
import type { SourceExtraction } from "@/lib/graph/schemas";

// Public EVIDENCE KNOWLEDGE GRAPH endpoint. Given either cached `source_ids` or an
// ad-hoc `text` passage, Claude reads each source's raw_text and extracts biomedical
// entities + typed relations (heavy Claude reasoning — BUILD_MINDSET rule 1). Every
// relation is grounded to an exact supporting sentence via the deterministic grounding
// layer (rule 2); ungroundable relations are dropped. The grounded per-source
// extractions are aggregated into a { nodes, edges } graph where every edge carries
// its provenance (source + grounded span). Envelope responses; NEVER logs source text.
export const runtime = "nodejs";

const BodySchema = z
  .object({
    source_ids: z.array(z.string().uuid()).min(1).max(20).optional(),
    text: z.string().optional(),
  })
  .refine((b) => (b.source_ids && b.source_ids.length > 0) || (b.text && b.text.length > 0), {
    message: "Provide either source_ids (cached sources) or text (a passage to extract).",
  });

interface SourceRow {
  id: string;
  raw_text: string;
}

// Load the named cached sources, matching the PUBLIC unscoped read pattern used by the
// other source-reading compute routes. Parameterized `= ANY($1)` — never interpolated.
async function loadSources(ids: readonly string[]): Promise<SourceRow[]> {
  const pool = getPool();
  const { rows } = await pool.query<SourceRow>(
    `SELECT id, raw_text FROM sources WHERE id = ANY($1::uuid[])`,
    [ids]
  );
  return rows;
}

export async function POST(req: NextRequest) {
  const start = Date.now();
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";

  const rate = checkRateLimit(ip);
  if (!rate.allowed) {
    logEvent("graph.rate_limited", { ip });
    return fail("Rate limit reached. Please try again shortly.", 429);
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail("Request body must be valid JSON.", 400);
  }

  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    return fail(`Invalid graph request — ${where}${issue?.message ?? "check your inputs."}`, 400);
  }

  // Assemble the { source_id, raw_text } pairs to extract from, from EITHER path.
  // The ad-hoc `text` path is sanitised with the same hardening as /api/verify
  // (control chars, invisible/bidi smuggling, length cap) before it reaches Claude.
  const inputs: Array<{ source_id: string; raw_text: string }> = [];

  if (parsed.data.text) {
    const sanitized = sanitizeClaimText(parsed.data.text, {
      maxLength: 12000,
      tooLongError: "Text is too long (max 12000 characters). Paste a single abstract or passage.",
    });
    if (!sanitized.ok) return fail(sanitized.error, 400);
    if (sanitized.value.length < 40) {
      return fail("Please provide a passage of at least 40 characters to extract a graph from.", 400);
    }
    inputs.push({ source_id: "text-input", raw_text: sanitized.value });
  }

  let missingIds: string[] = [];
  if (parsed.data.source_ids && parsed.data.source_ids.length > 0) {
    const sourceIds = Array.from(new Set(parsed.data.source_ids));
    try {
      const rows = await loadSources(sourceIds);
      const found = new Set(rows.map((r) => r.id));
      missingIds = sourceIds.filter((id) => !found.has(id));
      for (const r of rows) {
        inputs.push({ source_id: r.id, raw_text: r.raw_text ?? "" });
      }
    } catch (err) {
      logEvent("graph.load_error", { latencyMs: Date.now() - start, error: String(err) });
      return fail("Couldn't load the requested sources. Please try again.", 500);
    }
  }

  if (inputs.length === 0) {
    logEvent("graph.no_sources", { latencyMs: Date.now() - start });
    return fail(
      "None of the requested source ids were found in the cache. Load or ingest the sources first.",
      404
    );
  }

  try {
    // Heavy Claude work, isolated per source so one bad/failed extraction can't sink
    // the whole graph. A source that throws (invalid JSON / schema) contributes an
    // empty extraction and is counted in `failed_sources` for transparency.
    let failedSources = 0;
    const settled = await Promise.all(
      inputs.map(async (input): Promise<SourceExtraction> => {
        try {
          return await extractGraphFromSource(input.source_id, input.raw_text);
        } catch (err) {
          failedSources += 1;
          logEvent("graph.source_extract_error", {
            // Log the id (a UUID / "text-input"), never the source text itself.
            source_id: input.source_id,
            error: String(err),
          });
          return {
            source_id: input.source_id,
            entities: [],
            relations: [],
            dropped_relations: 0,
          };
        }
      })
    );

    const graph = buildEvidenceGraph(settled);

    logEvent("graph.success", {
      latencyMs: Date.now() - start,
      requested: inputs.length,
      failedSources,
      missing: missingIds.length,
      nodes: graph.stats.node_count,
      edges: graph.stats.edge_count,
      grounded: graph.stats.grounded_relation_count,
      dropped: graph.stats.dropped_relation_count,
    });

    return ok({
      graph,
      failed_sources: failedSources,
      missing_source_ids: missingIds,
    });
  } catch (err) {
    logEvent("graph.error", { latencyMs: Date.now() - start, error: String(err) });
    return fail(
      "Something went wrong building the evidence graph. This has been logged — please try again.",
      500
    );
  }
}
