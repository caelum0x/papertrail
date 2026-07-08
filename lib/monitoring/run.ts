import { retrieveSources } from "@/lib/agents/retrievalAgent";
import type { Monitor } from "@/lib/monitoring/types";
import { upsertHit, touchMonitorRun } from "@/lib/monitoring/repo";

// Executes a monitor: runs its query through the shared retrieval agent
// (PubMed / ClinicalTrials.gov, cache-first), then records each returned source
// as a hit. Hits are deduped in the repo, so re-running only surfaces genuinely
// new sources. Returns how many candidates were considered and how many were new.

export interface RunMonitorResult {
  considered: number;
  newHits: number;
}

export async function runMonitor(monitor: Monitor): Promise<RunMonitorResult> {
  const allowed = new Set(monitor.sources);
  const candidates = await retrieveSources(monitor.query);

  let considered = 0;
  let newHits = 0;

  for (const candidate of candidates) {
    // Only record hits from source backends this monitor is configured for.
    if (!allowed.has(candidate.source_type)) {
      continue;
    }
    considered += 1;
    const inserted = await upsertHit({
      orgId: monitor.org_id,
      monitorId: monitor.id,
      sourceType: candidate.source_type,
      externalId: candidate.external_id,
      title: candidate.title,
      url: candidate.url,
    });
    if (inserted) {
      newHits += 1;
    }
  }

  await touchMonitorRun(monitor.org_id, monitor.id);

  return { considered, newHits };
}
