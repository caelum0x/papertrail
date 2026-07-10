"use client";

import {
  ENTITY_COLORS,
  PREDICATE_LABELS,
  type EvidenceGraph,
  type GraphEdge,
} from "./types";

// Detail panel for a selected edge: shows the typed relation and EVERY grounded
// source sentence that supports it. This is the trust surface — an edge exists only
// because each of these sentences was located verbatim in a source's raw_text.

interface EdgeDetailProps {
  graph: EvidenceGraph;
  edge: GraphEdge | null;
}

export function EdgeDetail({ graph, edge }: EdgeDetailProps) {
  if (!edge) {
    return (
      <div className="rounded border border-ink/10 bg-white p-4 text-sm text-ink/40">
        Click an edge in the graph to see the exact source sentence that grounds it.
      </div>
    );
  }

  const subject = graph.nodes.find((n) => n.id === edge.source);
  const object = graph.nodes.find((n) => n.id === edge.target);

  return (
    <div className="rounded border border-ink/10 bg-white p-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span
          className="rounded px-2 py-0.5 font-medium text-white"
          style={{ backgroundColor: subject ? ENTITY_COLORS[subject.type] : "#6B7280" }}
        >
          {subject?.label ?? edge.source}
        </span>
        <span className="text-ink/50">{PREDICATE_LABELS[edge.predicate]}</span>
        <span
          className="rounded px-2 py-0.5 font-medium text-white"
          style={{ backgroundColor: object ? ENTITY_COLORS[object.type] : "#6B7280" }}
        >
          {object?.label ?? edge.target}
        </span>
      </div>

      <p className="mt-3 text-xs uppercase tracking-wide text-ink/40">
        {edge.provenance.length} grounded source sentence{edge.provenance.length === 1 ? "" : "s"}
      </p>

      <ul className="mt-2 space-y-3">
        {edge.provenance.map((p, i) => (
          <li key={`${p.source_id}-${i}`} className="border-l-2 border-accent/60 pl-3">
            <blockquote className="text-sm italic text-ink/80">&ldquo;{p.grounded_sentence}&rdquo;</blockquote>
            <p className="mt-1 text-xs text-ink/40">
              source {shortId(p.source_id)} · char {p.grounding.start}–{p.grounding.end} ·{" "}
              {p.grounding.status === "exact" ? "exact match" : "normalized match"}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function shortId(id: string): string {
  if (id === "text-input") return "pasted text";
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}
