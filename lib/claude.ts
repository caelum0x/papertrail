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
// Extract the first balanced JSON value (object or array) from a text that may contain
// surrounding prose — a common LLM behavior where the model explains before/after the JSON.
// Tracks string state + escapes so braces inside strings don't throw off the depth count.
function extractFirstJson(text: string): string | null {
  const startIdx = (() => {
    const obj = text.indexOf("{");
    const arr = text.indexOf("[");
    if (obj === -1) return arr;
    if (arr === -1) return obj;
    return Math.min(obj, arr);
  })();
  if (startIdx === -1) return null;

  const open = text[startIdx];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = startIdx; i < text.length; i++) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return text.slice(startIdx, i + 1);
    }
  }
  return null;
}

// Parse a model text block into JSON, tolerating code fences and surrounding prose.
function parseJsonLoose(text: string): unknown | undefined {
  const cleaned = text
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "");
  try {
    return JSON.parse(cleaned);
  } catch {
    const extracted = extractFirstJson(cleaned);
    if (extracted !== null) {
      try {
        return JSON.parse(extracted);
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
}

export async function callClaudeForJson<T>(params: {
  system: string;
  user: string;
  schema: { parse: (v: unknown) => T };
  maxTokens?: number;
}): Promise<T> {
  const anthropic = getClaude();

  const call = async (system: string, user: string): Promise<unknown | undefined> => {
    const response = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: params.maxTokens ?? 1024,
      system,
      messages: [{ role: "user", content: user }],
    });
    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new Error("Claude response contained no text block");
    }
    return parseJsonLoose(textBlock.text);
  };

  // First attempt with the caller's prompt (prose-tolerant parse).
  let parsedJson = await call(params.system, params.user);

  // One stricter retry when the model editorialized instead of emitting a JSON value.
  if (parsedJson === undefined) {
    const strictSystem =
      params.system +
      "\n\nCRITICAL: Respond with ONLY a single JSON value — no explanation, no reasoning, " +
      "no prose before or after it. The first character of your reply must be { or [.";
    parsedJson = await call(strictSystem, params.user);
  }

  if (parsedJson === undefined) {
    throw new Error("Claude did not return valid JSON after a retry.");
  }

  return params.schema.parse(parsedJson);
}
