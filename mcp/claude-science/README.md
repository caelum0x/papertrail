# Adding PaperTrail to Anthropic Claude Science

PaperTrail ships an MCP server so you can add its **deterministic
evidence-verification engine** directly to Claude Science as a Connector. Once
added, you can stay in your Claude session and say things like:

> "Verify this efficacy claim against its registry."
>
> "Run a random-effects meta-analysis on these three trials and give me the
> pooled effect with heterogeneity."
>
> "Fact-check this paragraph of my discussion section and flag any claim the
> source doesn't support."

Claude routes the request to the matching PaperTrail tool, the **deterministic
engine** computes the answer server-side, and the sourced result comes back
in-session. The numbers and flags are PaperTrail's, not the model's.

## 1. Build the server once

```bash
cd mcp
npm install
npm run build      # produces mcp/dist/server.js
```

## 2. Add the Connector

In Claude Science go to **Capabilities -> Connectors -> Add custom connector**
and provide a local (stdio) MCP server:

- **Command:** `node`
- **Arguments:** the absolute path to `dist/server.js`
  (e.g. `/Users/you/papertrail/mcp/dist/server.js`)
- **Environment:**
  - `PAPERTRAIL_BASE_URL` = `https://papertrail-topaz-phi.vercel.app`
    (optional — this is the default; override for a private deployment)
  - `PAPERTRAIL_API_KEY` = your org API key
    (optional — only needed for the org-scoped tools `structure_experiment` and
    `match_patient_to_trials`)

### `connector.json`

The companion [`connector.json`](./connector.json) in this folder is a
ready-to-paste config. Replace `dist/server.js` with the **absolute** path on
your machine when you register it:

```json
{
  "mcpServers": {
    "papertrail": {
      "command": "node",
      "args": ["/absolute/path/to/mcp/dist/server.js"],
      "env": {
        "PAPERTRAIL_BASE_URL": "https://papertrail-topaz-phi.vercel.app"
      }
    }
  }
}
```

## 3. `.mcp.json`-style example (Claude Code / Desktop / any MCP host)

Any MCP host that reads an `.mcp.json` (or equivalent `mcpServers` block) can use
the same server. Add an org key only if you need the authenticated tools:

```json
{
  "mcpServers": {
    "papertrail": {
      "command": "node",
      "args": ["/absolute/path/to/mcp/dist/server.js"],
      "env": {
        "PAPERTRAIL_BASE_URL": "https://papertrail-topaz-phi.vercel.app",
        "PAPERTRAIL_API_KEY": "pt_live_your_org_key_here"
      }
    }
  }
}
```

## 4. Verify it works

After adding the Connector, the PaperTrail tools appear in the tool list
(`verify_claim`, `meta_analysis`, `bio_verify_claim`, and the rest — see the
[main README](../README.md#tool-catalogue) for the full catalogue). Try:

> "Use verify_claim to check: 'Drug X reduced major cardiovascular events by 30%
> in the trial.'"

You should get a trust score, the matched primary source, and any flagged
discrepancy — computed by the deployed engine.

## Notes

- The server talks to the **live** PaperTrail API over HTTPS; it needs outbound
  network access but no local database.
- Only outbound stdout is the MCP protocol; the single startup banner goes to
  stderr, so it will not interfere with the host.
- Set `PAPERTRAIL_BASE_URL=http://localhost:3000` to point the Connector at a
  local PaperTrail dev server instead of production.
