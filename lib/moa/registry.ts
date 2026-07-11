// PaperTrail MoA — the agent REGISTRY. The single place that imports every backend engine
// agent and exposes the roster the router selects from. The scheduler orders whichever of
// these are selected by their produces/consumes into composition layers.

import type { MoaAgent } from "./types";

// Layer 1 · enrichers (produce artifacts)
import scispacy from "./agents/scispacy";
import quantExtractor from "./agents/quant-extractor";
import paperqa from "./agents/paperqa";
import loki from "./agents/loki";
import pytrials from "./agents/pytrials";
import indra from "./agents/indra";
import r2r from "./agents/r2r";
// Layer 2 · verifiers (consume + vote)
import minicheck from "./agents/minicheck";
import multivers from "./agents/multivers";
import pymare from "./agents/pymare";
import valsci from "./agents/valsci";
// Layer 3 · deliberation
import storm from "./agents/storm";
import iterative from "./agents/iterative";
import autoreview from "./agents/autoreview";
import autogather from "./agents/autogather";
import autoloop from "./agents/autoloop";
// Registered, usually gated out for a plain claim (need absent context)
import asreview from "./agents/asreview";
import pyalex from "./agents/pyalex";
import pykeen from "./agents/pykeen";
import biocypher from "./agents/biocypher";
import evidenceIntegrator from "./agents/evidence-integrator";

export const AGENTS: readonly MoaAgent[] = [
  scispacy,
  quantExtractor,
  paperqa,
  loki,
  pytrials,
  indra,
  r2r,
  minicheck,
  multivers,
  pymare,
  valsci,
  storm,
  iterative,
  autoreview,
  autogather,
  autoloop,
  asreview,
  pyalex,
  pykeen,
  biocypher,
  evidenceIntegrator,
];

export function getAgent(id: string): MoaAgent | undefined {
  return AGENTS.find((a) => a.id === id);
}
