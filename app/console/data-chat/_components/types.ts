import type {
  DataChatResponse,
  DataChatToolTrace,
  DataCitation,
} from "@/lib/dataChat/schemas";

// Client-side view of a chat turn. Assistant turns carry the grounded answer plus
// the tool trace and citations the server assigned; user turns are plain text.
export interface DataChatTurn {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolTrace?: DataChatToolTrace[];
  citations?: DataCitation[];
  iterations?: number;
}

export type { DataChatResponse, DataChatToolTrace, DataCitation };
