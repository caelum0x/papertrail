"use client";

import { useMemo } from "react";
import { layoutGraph, type PositionedNode } from "./layout";
import { ENTITY_COLORS, PREDICATE_LABELS, type EvidenceGraph, type GraphEdge } from "./types";

// Deterministic node-link visualisation rendered as pure SVG — no chart/graph
// library. Positions come from the seeded force layout so the same graph always
// looks identical. Clicking an edge selects it (the parent shows the grounded
// source sentence). Node radius scales with degree; colour encodes entity type.

const WIDTH = 760;
const HEIGHT = 520;
const MIN_R = 6;
const MAX_R = 16;

interface GraphCanvasProps {
  graph: EvidenceGraph;
  selectedEdgeId: string | null;
  onSelectEdge: (edge: GraphEdge) => void;
}

function radiusForDegree(degree: number, maxDegree: number): number {
  if (maxDegree <= 0) return MIN_R;
  return MIN_R + (MAX_R - MIN_R) * Math.min(1, degree / maxDegree);
}

export function GraphCanvas({ graph, selectedEdgeId, onSelectEdge }: GraphCanvasProps) {
  const { nodes } = useMemo(
    () => layoutGraph(graph.nodes, graph.edges, { width: WIDTH, height: HEIGHT }),
    [graph.nodes, graph.edges]
  );

  const byId = useMemo(() => new Map<string, PositionedNode>(nodes.map((n) => [n.id, n])), [nodes]);
  const maxDegree = useMemo(() => nodes.reduce((m, n) => Math.max(m, n.degree), 0), [nodes]);

  if (graph.nodes.length === 0) {
    return (
      <div className="flex h-[520px] items-center justify-center rounded border border-ink/10 bg-white text-sm text-ink/40">
        No grounded entities or relations were extracted.
      </div>
    );
  }

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className="w-full rounded border border-ink/10 bg-white"
      role="img"
      aria-label="Evidence knowledge graph of entities and grounded relations"
    >
      <defs>
        <marker
          id="graph-arrow"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#9CA3AF" />
        </marker>
      </defs>

      {/* Edges first so nodes render on top. */}
      {graph.edges.map((edge) => {
        const a = byId.get(edge.source);
        const b = byId.get(edge.target);
        if (!a || !b) return null;
        const selected = edge.id === selectedEdgeId;
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        return (
          <g
            key={edge.id}
            className="cursor-pointer"
            onClick={() => onSelectEdge(edge)}
            role="button"
            aria-label={`${a.label} ${PREDICATE_LABELS[edge.predicate]} ${b.label}`}
          >
            {/* Wide invisible hit area for easier clicking. */}
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" strokeWidth={12} />
            <line
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={selected ? "#C4522A" : "#9CA3AF"}
              strokeWidth={selected ? 2.5 : 1.25}
              markerEnd="url(#graph-arrow)"
              opacity={selectedEdgeId && !selected ? 0.35 : 1}
            />
            <text
              x={mx}
              y={my - 3}
              textAnchor="middle"
              fontSize={9}
              fill={selected ? "#C4522A" : "#6B7280"}
              className="pointer-events-none select-none"
            >
              {PREDICATE_LABELS[edge.predicate]}
              {edge.provenance.length > 1 ? ` (${edge.provenance.length})` : ""}
            </text>
          </g>
        );
      })}

      {nodes.map((n) => {
        const r = radiusForDegree(n.degree, maxDegree);
        return (
          <g key={n.id} className="pointer-events-none">
            <circle cx={n.x} cy={n.y} r={r} fill={ENTITY_COLORS[n.type]} opacity={0.9} />
            <text
              x={n.x}
              y={n.y + r + 11}
              textAnchor="middle"
              fontSize={10}
              fill="#111318"
              className="select-none"
            >
              {n.label.length > 26 ? `${n.label.slice(0, 25)}…` : n.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
