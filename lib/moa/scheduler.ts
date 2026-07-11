// PaperTrail MoA — the SCHEDULER. Turns the agents' declared produces/consumes into a
// real execution DAG: an agent runs only AFTER the agents that produce the artifacts it
// consumes. Agents are grouped into LAYERS (longest-path from a root); a whole layer runs
// in parallel, then its produced artifacts are written to the blackboard before the next
// layer starts — so downstream agents genuinely read upstream findings.
//
// Deterministic: same selected set => same layering => same execution order. Cycle-safe:
// a back-edge (should never occur with the artifact taxonomy) is dropped so scheduling
// always terminates.

import type { AgentContribution, MoaAgent, OrchestrationContext } from "./types";
import { erroredContribution } from "./types";
import { MoaBlackboard } from "./blackboard";

export interface ScheduledLayer {
  index: number;
  agentIds: string[];
}

export interface ScheduleResult {
  // Contributions in completion order.
  contributions: AgentContribution[];
  // The layer structure that was executed (for the UI DAG).
  layers: ScheduledLayer[];
  // kind -> producing agent, for the trace.
  provenance: Array<{ kind: string; agentId: string }>;
  blackboard: MoaBlackboard;
}

// Assign each selected agent a layer index = longest dependency chain to a root. An agent
// depends on another selected agent when it consumes a kind that agent produces.
function computeLayers(agents: readonly MoaAgent[]): Map<string, number> {
  const byId = new Map(agents.map((a) => [a.id, a]));

  // producersByKind: artifact kind -> agent ids (within the selected set) that produce it.
  const producersByKind = new Map<string, string[]>();
  for (const a of agents) {
    for (const kind of a.produces) {
      const arr = producersByKind.get(kind) ?? [];
      arr.push(a.id);
      producersByKind.set(kind, arr);
    }
  }

  // Direct dependencies of an agent: producers of any kind it consumes (excluding itself).
  const depsOf = (a: MoaAgent): string[] => {
    const deps = new Set<string>();
    for (const kind of a.consumes) {
      for (const producerId of producersByKind.get(kind) ?? []) {
        if (producerId !== a.id) deps.add(producerId);
      }
    }
    return Array.from(deps);
  };

  const layer = new Map<string, number>();
  const visiting = new Set<string>();

  const resolve = (id: string): number => {
    const cached = layer.get(id);
    if (cached !== undefined) return cached;
    if (visiting.has(id)) return 0; // cycle back-edge: treat as root to terminate.
    visiting.add(id);
    const agent = byId.get(id);
    const deps = agent ? depsOf(agent) : [];
    let lvl = 0;
    for (const d of deps) {
      lvl = Math.max(lvl, resolve(d) + 1);
    }
    visiting.delete(id);
    layer.set(id, lvl);
    return lvl;
  };

  for (const a of agents) resolve(a.id);
  return layer;
}

// Run one agent with a hard guard; a thrown error becomes an honest insufficient vote.
async function runAgent(
  agent: MoaAgent,
  ctx: OrchestrationContext,
  bb: MoaBlackboard
): Promise<AgentContribution> {
  try {
    return await agent.run(ctx, bb);
  } catch (err) {
    return erroredContribution(agent.id, err);
  }
}

/**
 * Schedule + run the selected agents as a composition DAG. Layers execute in order; within
 * a layer agents run in parallel and then their produced artifacts are committed to the
 * blackboard, so a layer always sees every prior layer's findings. Pure orchestration —
 * the only mutation is the internal blackboard, which is returned for the trace.
 */
export async function schedule(
  selected: readonly MoaAgent[],
  ctx: OrchestrationContext
): Promise<ScheduleResult> {
  const bb = new MoaBlackboard();
  const layerIndex = computeLayers(selected);

  // Group agents by layer, stable id order within a layer for reproducibility.
  const maxLayer = selected.reduce((m, a) => Math.max(m, layerIndex.get(a.id) ?? 0), 0);
  const layers: ScheduledLayer[] = [];
  const contributions: AgentContribution[] = [];

  for (let i = 0; i <= maxLayer; i++) {
    const inLayer = selected
      .filter((a) => (layerIndex.get(a.id) ?? 0) === i)
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    if (inLayer.length === 0) continue;

    layers.push({ index: i, agentIds: inLayer.map((a) => a.id) });

    // Run the whole layer in parallel against the blackboard as it stands after prior layers.
    const layerResults = await Promise.all(inLayer.map((a) => runAgent(a, ctx, bb)));

    // Commit this layer's produced artifacts so the NEXT layer can consume them.
    inLayer.forEach((agent, idx) => {
      const contribution = layerResults[idx];
      contributions.push(contribution);
      for (const [kind, payload] of Object.entries(contribution.produced)) {
        if (payload !== undefined) {
          // Cast is safe: produced is keyed by ArtifactKind with matching payloads.
          bb.put(agent.id, kind as never, payload as never);
        }
      }
    });
  }

  return {
    contributions,
    layers,
    provenance: bb.provenance(),
    blackboard: bb,
  };
}
