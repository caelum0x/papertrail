import type { CopilotResponse, ToolTrace, Citation } from "@/lib/copilot/schemas";

// Client-side view of a chat turn. Assistant turns carry the grounded answer plus
// the tool trace and citations the server assigned; user turns are plain text.
export interface ChatTurn {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolTrace?: ToolTrace[];
  citations?: Citation[];
  iterations?: number;
}

export type { CopilotResponse, ToolTrace, Citation };
