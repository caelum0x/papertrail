import Anthropic from "@anthropic-ai/sdk";

let client: Anthropic | undefined;

export function getClaude(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY is not set");
    }
    client = new Anthropic({ apiKey });
  }
  return client;
}

export const CLAUDE_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";

/**
 * Calls Claude with a prompt that must return a single JSON object, and
 * validates it against the provided Zod schema. Throws if the model doesn't
 * produce valid JSON or the JSON doesn't match the schema - callers decide
 * how to handle that (usually: surface a "couldn't verify" state, never
 * silently fabricate a result).
 */
export async function callClaudeForJson<T>(params: {
  system: string;
  user: string;
  schema: { parse: (v: unknown) => T };
  maxTokens?: number;
}): Promise<T> {
  const anthropic = getClaude();
  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: params.maxTokens ?? 1024,
    system: params.system,
    messages: [{ role: "user", content: params.user }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Claude response contained no text block");
  }

  const cleaned = textBlock.text
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "");

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(cleaned);
  } catch {
    throw new Error(`Claude did not return valid JSON: ${cleaned.slice(0, 200)}`);
  }

  return params.schema.parse(parsedJson);
}
