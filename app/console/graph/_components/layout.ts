import type { GraphEdge, GraphNode } from "./types";

// Deterministic force-directed layout — a small, self-contained
// Fruchterman-Reingold style relaxation. It is fully deterministic: initial
// positions come from a seeded hash of each node id (NOT Math.random), and it runs
// a fixed number of iterations, so the same graph always lays out identically
// (reproducible for a demo / screenshot, and stable across re-renders).

export interface PositionedNode extends GraphNode {
  x: number;
  y: number;
}

export interface LayoutResult {
  nodes: PositionedNode[];
  width: number;
  height: number;
}

const ITERATIONS = 300;

// Deterministic [0,1) pseudo-random from a string seed (FNV-1a hash → unit float).
function seededUnit(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // Map the 32-bit hash into [0, 1).
  return ((h >>> 0) % 100000) / 100000;
}

/**
 * Compute a stable 2D layout for the graph. Pure function of its inputs; returns
 * new positioned nodes without mutating the originals.
 */
export function layoutGraph(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  size: { width: number; height: number }
): LayoutResult {
  const { width, height } = size;
  if (nodes.length === 0) return { nodes: [], width, height };

  const k = Math.sqrt((width * height) / nodes.length) * 0.7; // ideal edge length
  const center = { x: width / 2, y: height / 2 };

  // Seed positions deterministically from the node id in a ring around center.
  const pos = nodes.map((n) => {
    const angle = seededUnit(n.id) * Math.PI * 2;
    const radius = (0.15 + 0.35 * seededUnit(n.id + "r")) * Math.min(width, height);
    return { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius };
  });

  const index = new Map(nodes.map((n, i) => [n.id, i]));

  let temp = Math.min(width, height) / 10;
  const cool = temp / (ITERATIONS + 1);

  for (let iter = 0; iter < ITERATIONS; iter++) {
    const disp = pos.map(() => ({ x: 0, y: 0 }));

    // Repulsive forces between every pair of nodes.
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        let dx = pos[i].x - pos[j].x;
        let dy = pos[i].y - pos[j].y;
        let dist = Math.hypot(dx, dy) || 0.01;
        const rep = (k * k) / dist;
        const ux = dx / dist;
        const uy = dy / dist;
        disp[i].x += ux * rep;
        disp[i].y += uy * rep;
        disp[j].x -= ux * rep;
        disp[j].y -= uy * rep;
      }
    }

    // Attractive forces along edges.
    for (const e of edges) {
      const a = index.get(e.source);
      const b = index.get(e.target);
      if (a === undefined || b === undefined || a === b) continue;
      const dx = pos[a].x - pos[b].x;
      const dy = pos[a].y - pos[b].y;
      const dist = Math.hypot(dx, dy) || 0.01;
      const att = (dist * dist) / k;
      const ux = dx / dist;
      const uy = dy / dist;
      disp[a].x -= ux * att;
      disp[a].y -= uy * att;
      disp[b].x += ux * att;
      disp[b].y += uy * att;
    }

    // Apply displacement capped by temperature, then pull gently toward center.
    for (let i = 0; i < nodes.length; i++) {
      const d = Math.hypot(disp[i].x, disp[i].y) || 0.01;
      pos[i].x += (disp[i].x / d) * Math.min(d, temp);
      pos[i].y += (disp[i].y / d) * Math.min(d, temp);
      pos[i].x += (center.x - pos[i].x) * 0.01;
      pos[i].y += (center.y - pos[i].y) * 0.01;
    }

    temp -= cool;
  }

  // Clamp inside the viewport with padding.
  const pad = 40;
  const positioned: PositionedNode[] = nodes.map((n, i) => ({
    ...n,
    x: Math.max(pad, Math.min(width - pad, pos[i].x)),
    y: Math.max(pad, Math.min(height - pad, pos[i].y)),
  }));

  return { nodes: positioned, width, height };
}
