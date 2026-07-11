// Console-side view types for the OPTIONAL deep-mixture path (`POST /api/moa/verify-claim`).
// The fast single-source verify path never touches these — this file only backs the subtle
// "Run deep mixture" toggle, which retrieves cached sources for the claim server-side and runs
// the full Mixture-of-Agents composition. Types mirror the wire payload exactly (no `any`) so
// the verify page stays decoupled from the engine libs (which we must NOT edit).

// One deterministic aggregate verdict from the mixture (distinct from the single-source
// discrepancy verdict — this is a supported/refuted/mixed/insufficient call across sources).
export type MoaVerdict = "supported" | "refuted" | "mixed" | "insufficient";

export interface MoaGroundedSpan {
  sourceId: string;
  text: string;
  start: number;
  end: number;
}

export type MoaSignal =
  | "supports"
  | "refutes"
  | "mixed"
  | "insufficient"
  | "neutral";

export interface MoaContribution {
  agentId: string;
  ran: boolean;
  signal: MoaSignal;
  confidence: number;
  summary: string;
  detail: Record<string, unknown>;
  groundedSpans: MoaGroundedSpan[];
  usedClaude: boolean;
  produced: Record<string, unknown>;
  error?: string;
}

export interface MoaAgentTrace {
  agentId: string;
  name: string;
  category: string;
  layer: number;
  finalGate: number;
  contribution: MoaContribution;
}

export interface MoaAggregate {
  verdict: MoaVerdict;
  trust: number;
  mass: { supports: number; refutes: number; mixed: number };
  agreement: number;
  counts: { voted: number; ran: number; total: number };
  weights: Array<{ agentId: string; signal: string; weight: number }>;
}

export interface MoaResult {
  claim: string;
  sourceCount: number;
  provenance: Array<{ kind: string; agentId: string }>;
  agents: MoaAgentTrace[];
  aggregate: MoaAggregate;
  narrative: string;
  narrativeUsedClaude: boolean;
  citations: MoaGroundedSpan[];
  usedClaude: boolean;
}

// Text-free source summary returned alongside the result (never raw_text).
export interface MoaSourceUsed {
  id: string;
  title: string | null;
  source_type: string;
  url: string | null;
}

// The `data` payload of the standard { success, data, error } envelope from the route.
export interface MoaVerifyClaimData {
  claim: string;
  retrieved: number;
  sourcesUsed: MoaSourceUsed[];
  facets: string[];
  result: MoaResult | null;
  message?: string;
}

// Presentational metadata for the mixture verdict badge — house Tailwind tokens, matching
// the orchestrator console's palette so the two views read consistently.
export interface MoaVerdictStyle {
  label: string;
  className: string;
}

export const MOA_VERDICT_STYLES: Record<MoaVerdict, MoaVerdictStyle> = {
  supported: {
    label: "Supported",
    className: "border-emerald-300 bg-emerald-50 text-emerald-700",
  },
  refuted: {
    label: "Refuted",
    className: "border-red-300 bg-red-50 text-red-700",
  },
  mixed: {
    label: "Mixed / contested",
    className: "border-amber-300 bg-amber-50 text-amber-700",
  },
  insufficient: {
    label: "Insufficient evidence",
    className: "border-ink/20 bg-ink/5 text-ink/60",
  },
};

export const MOA_SIGNAL_STYLES: Record<MoaSignal, string> = {
  supports: "bg-emerald-100 text-emerald-700",
  refutes: "bg-red-100 text-red-700",
  mixed: "bg-amber-100 text-amber-700",
  insufficient: "bg-ink/10 text-ink/50",
  neutral: "bg-sky-100 text-sky-700",
};
