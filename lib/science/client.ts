import { callClaudeForJson } from "@/lib/claude";
import {
  assistantReplySchema,
  type AssistantReply,
  type ScienceMessage,
} from "@/lib/science/types";

// Thin, honest connector for the Claude Science workbench beta.
//
// Two responsibilities:
//   1. Report whether the workbench connection is configured (env-driven), so the
//      UI and API can gracefully degrade instead of pretending a beta feature is
//      live when it isn't.
//   2. Run a research-assistant turn via Claude (callClaudeForJson), returning a
//      Zod-validated reply — no raw JSON.parse of model output is ever trusted.
//
// The workbench beta itself is not generally available; this connector does not
// fabricate a fake integration. When configured, `config` metadata is surfaced;
// the assistant reasoning always runs through the standard Claude API.

const MAX_HISTORY_TURNS = 12;
const MAX_REPLY_TOKENS = 1500;

export interface WorkbenchStatus {
  configured: boolean;
  endpoint: string | null;
  reason: string | null;
}

// Whether the Claude Science workbench beta is configured for this deployment.
// Presence of the (secret) API key env var is the source of truth; the DB
// connection row only holds non-secret metadata.
export function getWorkbenchStatus(): WorkbenchStatus {
  const key = process.env.CLAUDE_SCIENCE_API_KEY;
  const endpoint = process.env.CLAUDE_SCIENCE_ENDPOINT ?? null;
  if (!key) {
    return {
      configured: false,
      endpoint,
      reason:
        "Claude Science workbench is not configured. Research turns run through the standard Claude API.",
    };
  }
  return { configured: true, endpoint, reason: null };
}

export function isWorkbenchConfigured(): boolean {
  return getWorkbenchStatus().configured;
}

const SYSTEM_PROMPT = [
  "You are a research assistant for a clinical/translational-research team.",
  "You help review the scientific literature: framing questions, suggesting",
  "database queries (PubMed, ClinicalTrials.gov), and identifying primary",
  "sources. Be precise and honest about uncertainty. NEVER invent citations,",
  "PMIDs, DOIs, or trial IDs — if you are not certain a source exists, describe",
  "the search that would find it instead of fabricating a reference.",
  "",
  "Respond ONLY with a single JSON object of this exact shape:",
  "{",
  '  "content": string,                  // your prose reply to the researcher',
  '  "artifacts": {',
  '    "literatureQueries": string[],    // concrete search queries to run',
  '    "citations": [                    // only sources you are confident exist',
  '      { "title": string, "source": string, "note": string | null }',
  "    ],",
  '    "nextSteps": string[]             // suggested follow-up actions',
  "  }",
  "}",
  "Use empty arrays when a section does not apply. Do not wrap the JSON in prose.",
].join("\n");

function renderHistory(history: readonly ScienceMessage[]): string {
  return history
    .slice(-MAX_HISTORY_TURNS)
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join("\n\n");
}

// Runs one research-assistant turn. `history` is the prior conversation (oldest
// first) and `userMessage` is the new turn. Returns a validated AssistantReply.
// Throws on Claude/validation failure — callers surface an honest error state.
export async function runResearchTurn(params: {
  history: readonly ScienceMessage[];
  userMessage: string;
  workbenchEndpoint?: string | null;
}): Promise<AssistantReply> {
  const contextBlock =
    params.history.length > 0
      ? `Conversation so far:\n${renderHistory(params.history)}\n\n`
      : "";

  const user = `${contextBlock}New message from the researcher:\n${params.userMessage}`;

  return callClaudeForJson<AssistantReply>({
    system: SYSTEM_PROMPT,
    user,
    schema: assistantReplySchema,
    maxTokens: MAX_REPLY_TOKENS,
  });
}
