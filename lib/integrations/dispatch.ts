import { getPool } from "@/lib/db";
import { logEvent } from "@/lib/logger";
import { getProvider } from "@/lib/integrations/registry";
import { recordEvent } from "@/lib/integrations/repository";
import type { IntegrationTestResult } from "@/lib/integrations/types";

// Exercising a connector. `testIntegration` sends a synthetic event so an
// operator can confirm a connector is wired up, records the attempt in
// integration_events, and returns an honest result.
//
// Honesty rules (see registry.ts):
//   - slack / generic-webhook: make a REAL outbound POST to the configured URL.
//   - email: send only if an email relay is configured on the server
//     (EMAIL_RELAY_URL); otherwise report "not configured" rather than faking it.
//   - zotero / csv-import: no hard-required external call — validate config and
//     report readiness. We never pretend to have contacted a system we didn't.
//
// Every path is fully isolated from the caller: a slow or failing receiver must
// never throw. All errors are caught, recorded, and returned as a result.

// Per-request timeout so a hung receiver can't block the triggering request.
const TEST_TIMEOUT_MS = Number(process.env.INTEGRATION_TIMEOUT_MS || 5000);

interface Connector {
  id: string;
  provider: string;
  name: string;
  config: Record<string, unknown>;
}

function str(config: Record<string, unknown>, key: string): string | null {
  const v = config[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}

// A small, non-sensitive synthetic payload for test deliveries.
function testPayload(connector: Connector): Record<string, unknown> {
  return {
    type: "integration.test",
    integration: connector.name,
    provider: connector.provider,
    message: "PaperTrail test event — your connector is reachable.",
    sentAt: new Date().toISOString(),
  };
}

// POST a JSON body to a URL with a timeout. Returns the status code or null on
// network/timeout failure. Never throws.
async function postJson(
  url: string,
  body: Record<string, unknown>,
  extraHeaders?: Record<string, string>
): Promise<number | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "PaperTrail-Integrations/1.0",
        ...(extraHeaders ?? {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    return res.status;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function testSlack(connector: Connector): Promise<IntegrationTestResult> {
  const url = str(connector.config, "webhookUrl");
  if (!url) {
    return { ok: false, detail: "Slack webhook URL is not configured.", responseCode: null };
  }
  // Slack incoming webhooks expect a { text } body.
  const p = testPayload(connector);
  const code = await postJson(url, { text: `${p.message}` });
  const ok = code !== null && code >= 200 && code < 300;
  return {
    ok,
    detail: ok
      ? "Posted a test message to Slack."
      : code === null
        ? "Could not reach Slack (network error or timeout)."
        : `Slack responded with HTTP ${code}.`,
    responseCode: code,
  };
}

async function testGenericWebhook(
  connector: Connector
): Promise<IntegrationTestResult> {
  const url = str(connector.config, "url");
  if (!url) {
    return { ok: false, detail: "Endpoint URL is not configured.", responseCode: null };
  }
  const secret = str(connector.config, "secret");
  const headers = secret ? { "X-PaperTrail-Secret": secret } : undefined;
  const code = await postJson(url, testPayload(connector), headers);
  const ok = code !== null && code >= 200 && code < 300;
  return {
    ok,
    detail: ok
      ? "Delivered a test event to the endpoint."
      : code === null
        ? "Could not reach the endpoint (network error or timeout)."
        : `Endpoint responded with HTTP ${code}.`,
    responseCode: code,
  };
}

async function testEmail(connector: Connector): Promise<IntegrationTestResult> {
  const to = str(connector.config, "to");
  if (!to) {
    return { ok: false, detail: "Recipient email is not configured.", responseCode: null };
  }
  // We only send if a relay is configured server-side. This keeps the tool
  // honest: no real SMTP is bundled, so we don't claim a send we can't make.
  const relay = process.env.EMAIL_RELAY_URL;
  if (!relay) {
    return {
      ok: false,
      detail:
        "Email relay not configured on the server (set EMAIL_RELAY_URL). Configuration saved; delivery is disabled.",
      responseCode: null,
    };
  }
  const p = testPayload(connector);
  const code = await postJson(relay, {
    to,
    subject: `${str(connector.config, "subjectPrefix") ?? "[PaperTrail]"} Test`,
    text: `${p.message}`,
  });
  const ok = code !== null && code >= 200 && code < 300;
  return {
    ok,
    detail: ok
      ? `Sent a test email to ${to} via the configured relay.`
      : code === null
        ? "Could not reach the email relay (network error or timeout)."
        : `Email relay responded with HTTP ${code}.`,
    responseCode: code,
  };
}

function testManual(connector: Connector): IntegrationTestResult {
  // zotero / csv-import: config was already validated on save, so reaching here
  // means the connector is ready. We honestly report readiness, not a delivery.
  return {
    ok: true,
    detail:
      connector.provider === "zotero"
        ? "Zotero credentials saved. Ready to export verified sources."
        : "CSV mapping saved. Ready to import rows on upload.",
    responseCode: null,
  };
}

// Runs a provider-appropriate test and records it as an outbound event. Returns
// an honest result; never throws.
export async function testIntegration(
  orgId: string,
  connector: Connector
): Promise<IntegrationTestResult> {
  const def = getProvider(connector.provider);
  let result: IntegrationTestResult;
  try {
    if (!def) {
      result = {
        ok: false,
        detail: `Unknown provider "${connector.provider}".`,
        responseCode: null,
      };
    } else if (def.kind === "manual") {
      result = testManual(connector);
    } else if (connector.provider === "slack") {
      result = await testSlack(connector);
    } else if (connector.provider === "email") {
      result = await testEmail(connector);
    } else {
      result = await testGenericWebhook(connector);
    }
  } catch {
    result = {
      ok: false,
      detail: "Test failed unexpectedly.",
      responseCode: null,
    };
  }

  logEvent("integration.test", {
    orgId,
    integrationId: connector.id,
    provider: connector.provider,
    ok: result.ok,
    responseCode: result.responseCode,
  });

  await recordEvent(getPool(), {
    orgId,
    integrationId: connector.id,
    direction: "outbound",
    event: "integration.test",
    // Never persist the destination URL/secret — only the outcome.
    payload: { detail: result.detail, responseCode: result.responseCode },
    status: result.ok ? "success" : "failed",
  });

  return result;
}
