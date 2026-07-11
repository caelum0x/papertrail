// PaperTrail MoA — the BLACKBOARD implementation. Typed, single-producer-per-kind shared
// memory the agents compose through. An agent reads upstream artifacts with get(kind) and
// the scheduler writes an agent's produced artifacts with put() after it runs.
//
// Single-writer-per-kind by design: composition is a DAG, not a free-for-all. If two agents
// produce the same kind, the FIRST writer wins and the second is ignored (recorded), so the
// data flow stays deterministic and traceable.

import type {
  ArtifactKind,
  ArtifactPayloads,
  Blackboard,
} from "./types";

interface StoredArtifact {
  agentId: string;
  payload: unknown;
}

export class MoaBlackboard implements Blackboard {
  private readonly store = new Map<ArtifactKind, StoredArtifact>();
  // Kinds a later agent tried to overwrite — surfaced in the trace, never applied.
  private readonly rejectedWrites: Array<{ agentId: string; kind: ArtifactKind }> = [];

  get<K extends ArtifactKind>(kind: K): ArtifactPayloads[K] | undefined {
    const entry = this.store.get(kind);
    return entry ? (entry.payload as ArtifactPayloads[K]) : undefined;
  }

  has(kind: ArtifactKind): boolean {
    return this.store.has(kind);
  }

  put<K extends ArtifactKind>(agentId: string, kind: K, payload: ArtifactPayloads[K]): void {
    if (this.store.has(kind)) {
      this.rejectedWrites.push({ agentId, kind });
      return;
    }
    this.store.set(kind, { agentId, payload });
  }

  producerOf(kind: ArtifactKind): string | undefined {
    return this.store.get(kind)?.agentId;
  }

  // The full provenance map (kind -> producing agent) for the UI trace.
  provenance(): Array<{ kind: ArtifactKind; agentId: string }> {
    return Array.from(this.store.entries()).map(([kind, v]) => ({ kind, agentId: v.agentId }));
  }

  rejected(): ReadonlyArray<{ agentId: string; kind: ArtifactKind }> {
    return this.rejectedWrites;
  }
}
