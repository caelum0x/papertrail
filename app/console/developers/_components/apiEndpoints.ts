import { API_SPEC, type ApiEndpoint } from "@/lib/apiSpec";

// Public/developer-facing endpoint entries, prepended to the shared API_SPEC so
// the reference documents the API-key-authenticated verify route and the
// console webhook-management routes alongside the session endpoints.

const V1_VERIFY: ApiEndpoint = {
  method: "POST",
  path: "/api/v1/verify",
  request: `Headers:
  x-api-key: <your API key>        // required — create one under Developers
  Content-Type: application/json

Body:
{ "claim": string, "source_hint"?: string }
// claim: 10–2000 chars after trimming
// source_hint (optional): a DOI / PMID / NCT you actually cited, to pin retrieval`,
  response: `// 200 — standard envelope
{
  "success": true,
  "data": {
    "status": "verified",
    "verification_id": string | null,
    "claim": string,
    "source": { "title": string | null, "url": string, "source_type": string, "external_id": string, "raw_text": string },
    "finding": { ... },
    "verification": { "discrepancy_type": string, "trust_score": number, "explanation": string, "flagged_spans": [...] },
    "effect_size_check": { "verdict": string, ... }
  },
  "error": null
}

// 200 — no confident source
{ "success": true, "data": { "status": "no_support_found", "claim": string, "message": string }, "error": null }

// 401 invalid/missing key · 400 invalid input · 429 rate limited · 500 error
{ "success": false, "data": null, "error": string }`,
  description:
    "Public, API-key-authenticated verification endpoint. Authenticate with the x-api-key header (resolved to your org, rate-limited per key). Runs the full retrieval → extraction → verification pipeline and returns the standard envelope. On success, fires your org's verification.completed (and verification.flagged) webhooks.",
};

const WEBHOOKS_LIST: ApiEndpoint = {
  method: "GET",
  path: "/api/webhooks",
  request: `// session-authenticated (console), admin+ role.
// optional: ?limit= (1..100, default 20) &page=
curl "/api/webhooks?limit=100" -H "x-org-id: <org>"`,
  response: `// 200 — envelope
{
  "success": true,
  "data": [
    { "id": string, "url": string, "events": string[], "status": "active" | "disabled", "secretHint": string | null, "createdAt": string }
  ],
  "meta": { "total": number, "page": number, "limit": number },
  "error": null
}`,
  description:
    "Lists the org's registered webhooks. Admin or owner role required. The signing secret is never returned — only a short hint.",
};

const WEBHOOKS_CREATE: ApiEndpoint = {
  method: "POST",
  path: "/api/webhooks",
  request: `{ "url": string, "events": string[] }
// url: valid http(s) URL
// events: one or more of "verification.completed", "verification.flagged"`,
  response: `// 201 — envelope; secret shown ONCE
{
  "success": true,
  "data": { "id": string, "url": string, "events": string[], "status": "active", "secretHint": string, "secret": string, "createdAt": string },
  "error": null
}

// 400 invalid input · 403 not admin
{ "success": false, "data": null, "error": string }`,
  description:
    "Registers a webhook and returns its signing secret exactly once. Store the secret — deliveries are signed with HMAC-SHA256 in the X-PaperTrail-Signature header.",
};

const WEBHOOKS_DETAIL: ApiEndpoint = {
  method: "GET",
  path: "/api/webhooks/[id]",
  request: `// admin+; optional pagination for the delivery log
curl "/api/webhooks/<id>?limit=20"`,
  response: `// 200 — webhook + recent delivery attempts
{
  "success": true,
  "data": {
    "webhook": { "id": string, "url": string, "events": string[], "status": string, "secretHint": string | null, "createdAt": string },
    "deliveries": [ { "id": string, "webhookId": string, "event": string, "status": "success" | "failed" | "skipped", "responseCode": number | null, "createdAt": string } ]
  },
  "meta": { "total": number, "page": number, "limit": number },
  "error": null
}

// 404 not found`,
  description:
    "One webhook plus a paginated slice of its recent delivery attempts (newest first).",
};

const WEBHOOKS_UPDATE: ApiEndpoint = {
  method: "PATCH",
  path: "/api/webhooks/[id]",
  request: `{ "url"?: string, "events"?: string[], "status"?: "active" | "disabled" }
// provide at least one field`,
  response: `// 200 — updated webhook summary (envelope) · 400 invalid · 404 not found`,
  description:
    "Updates a webhook's URL, subscribed events, or enabled/disabled status. Admin or owner role required.",
};

const WEBHOOKS_DELETE: ApiEndpoint = {
  method: "DELETE",
  path: "/api/webhooks/[id]",
  request: `curl -X DELETE /api/webhooks/<id>`,
  response: `// 200 — deleted webhook summary (envelope) · 404 not found`,
  description:
    "Deletes a webhook and its delivery history (cascade). Admin or owner role required.",
};

const WEBHOOKS_TEST: ApiEndpoint = {
  method: "POST",
  path: "/api/webhooks/[id]/test",
  request: `curl -X POST /api/webhooks/<id>/test`,
  response: `// 200 — envelope
{ "success": true, "data": { "ok": boolean, "responseCode": number | null }, "error": null }`,
  description:
    "Sends a synthetic signed ping delivery to the webhook's URL and records the attempt, so you can confirm your receiver is wired up correctly.",
};

// Public/developer-facing endpoints first, then the shared spec entries.
export const ENDPOINTS: ApiEndpoint[] = [
  V1_VERIFY,
  WEBHOOKS_LIST,
  WEBHOOKS_CREATE,
  WEBHOOKS_DETAIL,
  WEBHOOKS_UPDATE,
  WEBHOOKS_DELETE,
  WEBHOOKS_TEST,
  ...API_SPEC,
];

export const V1_CURL = `curl -X POST https://your-deployment.vercel.app/api/v1/verify \\
  -H "x-api-key: pt_live_..." \\
  -H "Content-Type: application/json" \\
  -d '{"claim": "Drug X reduced major cardiac events by 30% in adults with heart failure."}'`;

export type { ApiEndpoint };
