#!/usr/bin/env node
// PaperTrail MCP server.
//
// Exposes PaperTrail's deterministic evidence-verification engine as MCP tools
// over stdio, so it can be added to Anthropic Claude Science as a Connector.
// It calls the DEPLOYED PaperTrail API over HTTP (see client.ts) and imports no
// app code. Each tool group lives in its own file under ./tools; this module
// only wires them into the MCP server with a uniform try/catch wrapper.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { PaperTrailClient } from "./client.js";
import type { PaperTrailTool } from "./registry.js";

import { verificationTools } from "./tools/verification.js";
import { synthesisTools } from "./tools/synthesis.js";
import { biomedicalTools } from "./tools/biomedical.js";
import { researchTools } from "./tools/research.js";
import { orgScopedTools } from "./tools/orgScoped.js";

const SERVER_NAME = "papertrail";
const SERVER_VERSION = "1.0.0";

// One shared HTTP client for the whole process. Resolves base URL / API key
// from PAPERTRAIL_BASE_URL / PAPERTRAIL_API_KEY (see client.ts).
const client = new PaperTrailClient();

// Every tool group, flattened. Adding a new file means importing its array
// above and appending it here.
const allTools: PaperTrailTool[] = [
  ...verificationTools,
  ...synthesisTools,
  ...biomedicalTools,
  ...researchTools,
  ...orgScopedTools,
];

function registerTools(server: McpServer): number {
  const seen = new Set<string>();
  for (const t of allTools) {
    if (seen.has(t.name)) {
      // A duplicate name would silently shadow a tool; fail loud on stderr.
      throw new Error(`Duplicate MCP tool name: ${t.name}`);
    }
    seen.add(t.name);

    server.registerTool(
      t.name,
      {
        title: t.title,
        description: t.description,
        inputSchema: t.inputSchema,
        annotations: t.annotations,
      },
      async (args: Record<string, unknown>) => {
        try {
          const text = await t.handler(args, client);
          return { content: [{ type: "text" as const, text }] };
        } catch (e) {
          return {
            content: [{ type: "text" as const, text: String(e) }],
            isError: true,
          };
        }
      }
    );
  }
  return seen.size;
}

async function main(): Promise<void> {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  const count = registerTools(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Startup banner on stderr only — stdout is reserved for the MCP protocol.
  process.stderr.write(
    `[papertrail-mcp] v${SERVER_VERSION} ready — ${count} tools, base ${
      process.env.PAPERTRAIL_BASE_URL ?? "https://papertrail-topaz-phi.vercel.app"
    }\n`
  );
}

main().catch((err: unknown) => {
  process.stderr.write(
    `[papertrail-mcp] fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`
  );
  process.exit(1);
});
