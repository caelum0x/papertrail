import { getPool } from "../db";
import { callClaudeForJson } from "../claude";
import { ExtractedFinding, ExtractedFindingSchema } from "../schemas";

const SYSTEM_PROMPT = `You are a precise scientific data extraction assistant.
Given the text of a clinical trial record or paper abstract, extract ONLY what
is explicitly stated. Do not infer, generalize, or fill in gaps with typical
values from similar studies. If a field is not stated, use "not reported".
Respond with ONLY a single JSON object matching this shape, no other text:
{
  "effect_size": string,
  "population": string,
  "condition": string,
  "endpoint": string,
  "caveats": string[]
}`;

/**
 * Extracts a structured finding from a source's raw text, caching the result
 * so repeat verifications against the same source don't re-spend API credits.
 */
export async function extractFinding(sourceId: string, rawText: string): Promise<ExtractedFinding> {
  const pool = getPool();

  const cached = await pool.query(
    `select effect_size, population, condition, endpoint, caveats
     from findings where source_id = $1`,
    [sourceId]
  );
  if (cached.rows.length > 0) {
    const row = cached.rows[0];
    return ExtractedFindingSchema.parse({
      effect_size: row.effect_size,
      population: row.population,
      condition: row.condition,
      endpoint: row.endpoint,
      caveats: row.caveats ?? [],
    });
  }

  const finding = await callClaudeForJson({
    system: SYSTEM_PROMPT,
    user: `Source text:\n\n${rawText.slice(0, 12000)}`,
    schema: ExtractedFindingSchema,
    maxTokens: 700,
  });

  await pool.query(
    `insert into findings (source_id, effect_size, population, condition, endpoint, caveats)
     values ($1, $2, $3, $4, $5, $6::jsonb)
     on conflict (source_id) do update set
       effect_size = excluded.effect_size,
       population = excluded.population,
       condition = excluded.condition,
       endpoint = excluded.endpoint,
       caveats = excluded.caveats`,
    [sourceId, finding.effect_size, finding.population, finding.condition, finding.endpoint, JSON.stringify(finding.caveats)]
  );

  return finding;
}
