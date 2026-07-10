// Biomedical evidence engines exposed as MCP tools.
//
// server.ts imports the single `biomedicalTools` array from here and registers
// each entry. The 11 tools are split across two files to keep each under the
// size budget: biomedicalCore.ts (annotation, safety, genetics, variant,
// target–disease) and biomedicalExtra.ts (unified verify, bioactivity, PGx, DDI,
// repurposing, biomarker). Every tool is a read-only wrapper over a deterministic
// PaperTrail /api/bio endpoint on the deployed server.

import type { PaperTrailTool } from "../registry.js";
import { biomedicalCoreTools } from "./biomedicalCore.js";
import { biomedicalExtraTools } from "./biomedicalExtra.js";

export const biomedicalTools: PaperTrailTool[] = [
  ...biomedicalCoreTools,
  ...biomedicalExtraTools,
];
