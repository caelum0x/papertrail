// Shared tool-catalog view types + schema helpers, extracted so the tools home,
// its try-it panel, and the overview sub-page share one source of truth.

export interface SchemaProperty {
  type?: string;
  description?: string;
  enum?: string[];
  items?: SchemaProperty;
}

export interface ToolInputSchema {
  type?: string;
  properties?: Record<string, SchemaProperty>;
  required?: string[];
}

export interface Tool {
  name: string;
  description: string;
  source: "builtin" | "registered";
  enabled: boolean;
  inputSchema: ToolInputSchema;
}

export interface CallResult {
  tool: string;
  output: unknown;
  durationMs: number;
  callId: string | null;
}

export interface ToolCall {
  id: string;
  toolName: string;
  input: Record<string, unknown>;
  output: unknown;
  status: "success" | "error";
  durationMs: number;
  createdAt: string;
}

export function fieldEntries(
  schema: ToolInputSchema
): Array<[string, SchemaProperty]> {
  return Object.entries(schema.properties ?? {});
}

// Editor+ roles may execute tools; enforced server-side, mirrored here for UX.
export function canRunTools(role: string | null): boolean {
  return role ? ["owner", "admin", "editor"].includes(role) : false;
}
