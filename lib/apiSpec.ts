// Single source of truth for the /api-docs page. Each entry documents an ACTUAL
// endpoint as implemented under app/api/**/route.ts — request/response are concise,
// readable strings (not live-validated schemas), kept in sync with the handlers by
// hand. If a route's contract changes, update the matching entry here.

export interface ApiEndpoint {
  method: string;
  path: string;
  request: string;
  response: string;
  description: string;
}

export const API_SPEC: ApiEndpoint[] = [
  {
    method: "POST",
    path: "/api/verify",
    request: `{ "claim": string, "source_hint"?: string }
// claim: 10–2000 chars after trimming
// source_hint (optional): a DOI / PMID / NCT you actually cited, to pin retrieval`,
    response: `// 200 — verified
{
  "status": "verified",
  "verification_id": string | null,   // null if the DB write failed (result still returned)
  "claim": string,
  "source": {
    "title": string | null,
    "url": string,
    "source_type": string,            // "pubmed" | "clinicaltrials"
    "external_id": string,
    "raw_text": string                // full cached source text
  },
  "finding": { ... },                 // structured extraction
  "verification": {
    "discrepancy_type": string,       // e.g. "accurate" | "magnitude_overstated" | ...
    "trust_score": number,            // 0–100
    "explanation": string,
    "flagged_spans": [ { "text": string, "grounding": { "start": number, "end": number } } ],
    "grounding_dropped_count": number
  },
  "effect_size_check": { "verdict": string, ... }
}

// 200 — no confident source
{ "status": "no_support_found", "message": string }

// 400 invalid JSON / claim length · 429 rate limited · 500 pipeline error
{ "error": string }`,
    description:
      "The core endpoint. Retrieves the best-matching primary source, extracts its finding, and returns a grounded verification whose flagged spans map to exact char offsets in source.raw_text. Rate-limited per client IP. Persistence is best-effort: a DB failure returns the result with verification_id: null.",
  },
  {
    method: "POST",
    path: "/api/verify/batch",
    request: `{ "claims"?: string[], "text"?: string }
// claims[] wins if present; otherwise "text" is split into claims.
// At most the first 5 claims are processed (hard cap), sequentially.`,
    response: `// 200
{
  "results": [
    {
      "claim": string,
      "status": "verified" | "no_support_found" | "error",
      "verification_id"?: string | null,
      "source"?: { "title": string | null, "url": string, "source_type": string, "external_id": string, "raw_text": string },
      "verification"?: { "discrepancy_type": string, "trust_score": number, "explanation": string, "flagged_spans": [...], "grounding_dropped_count": number },
      "effect_size_check"?: { "verdict": string, ... }
    }
  ],
  "truncated": boolean,        // true if more than 5 claims were detected
  "total_detected": number
}

// 400 invalid JSON / no claims detected · 429 rate limited
{ "error": string }`,
    description:
      "Runs the single-claim pipeline over multiple claims sequentially, capped at 5 per request to bound token spend. Each claim is isolated: one failure yields status: \"error\" for that item without sinking the batch.",
  },
  {
    method: "POST",
    path: "/api/verify/text",
    request: `{ "claim": string, "source_text": string }
// claim: >= 10 chars · source_text: 40–20000 chars, both after trimming`,
    response: `// 200
{
  "status": "verified",
  "claim": string,
  "source": { "title": "Pasted source", "url": "", "source_type": "custom", "raw_text": string },
  "finding": { ... },
  "verification": { "discrepancy_type": string, "trust_score": number, "explanation": string, "flagged_spans": [...], "grounding_dropped_count": number },
  "effect_size_check": { "verdict": string, ... }
}

// 400 invalid JSON / claim or source_text length · 429 rate limited · 500 error
{ "error": string }`,
    description:
      "Bring-your-own-source: verifies a claim against arbitrary pasted text. No retrieval, no DB read/write, so no permalink is minted (verification_id is omitted). Flagged spans are grounded against the pasted text.",
  },
  {
    method: "GET",
    path: "/api/verifications",
    request: `// optional: ?limit= (1..100, default 20) &offset= (>=0) &discrepancy_type=
curl "/api/verifications?limit=20&offset=0&discrepancy_type=magnitude_overstated"`,
    response: `// 200
{
  "items": [
    {
      "id": string,               // uuid
      "claim_text": string,
      "discrepancy_type": string,
      "trust_score": number,
      "created_at": string        // ISO timestamp
    }
  ],
  "total": number                 // total matching rows (for pagination)
}

// 500 { "error": string }`,
    description:
      "Paginated, newest-first list of stored verifications, optionally filtered by discrepancy_type. Returns items plus total for pagination.",
  },
  {
    method: "GET",
    path: "/api/verifications/[id]",
    request: `// [id] must be a valid UUID
curl /api/verifications/3f9c…-uuid`,
    response: `// 200 — mirrors POST /api/verify success shape, plus created_at.
{
  "status": "verified",
  "verification_id": string,
  "claim": string,
  "created_at": string,
  "source": { "title": string | null, "url": string | null, "source_type": string | null, "external_id": string | null, "raw_text": string } | null,
  "verification": { "discrepancy_type": string, "trust_score": number, "explanation": string, "flagged_spans": [...] },
  "effect_size_check": { "verdict": string, ... } | null
}

// 400 id not a valid UUID · 404 not found · 500 error
{ "error": string }`,
    description:
      "LLM-free shareable permalink for one stored verification. Stored flagged spans are re-grounded against the current cached source text so offsets stay valid. If the source was removed, source is null, flagged_spans is empty, and effect_size_check is null.",
  },
  {
    method: "GET",
    path: "/api/sources",
    request: `// optional: ?limit= (1..100, default 50) &offset= (>=0) &q= (title/external_id search)
curl "/api/sources?limit=50&offset=0&q=lecanemab"`,
    response: `// 200
{
  "items": [
    {
      "id": string,               // uuid
      "source_type": string,      // "pubmed" | "clinicaltrials"
      "external_id": string,
      "title": string | null,
      "url": string
    }
  ],
  "total": number                 // total matching sources (for pagination)
}

// 500 { "error": string }`,
    description:
      "Paginated list of the cached primary sources PaperTrail can verify against, optionally filtered by a title/external_id query. Full source text omitted from the list.",
  },
  {
    method: "GET",
    path: "/api/sources/[id]",
    request: `// [id] must be a valid UUID
curl /api/sources/a1b2…-uuid`,
    response: `// 200
{
  "source": {
    "id": string,
    "source_type": string,
    "external_id": string,
    "title": string | null,
    "url": string,
    "raw_text": string            // full cached source text
  },
  "verifications": [               // up to 50 verifications matched to this source, newest first
    { "id": string, "claim_text": string, "discrepancy_type": string, "trust_score": number, "created_at": string }
  ]
}

// 400 id not a valid UUID · 404 not found · 500 error
{ "error": string }`,
    description:
      "One cached source with its full text plus the verifications that matched against it.",
  },
  {
    method: "GET",
    path: "/api/stats",
    request: `curl /api/stats`,
    response: `// 200
{
  "total_verifications": number,
  "total_sources": number,
  "avg_trust_score": number | null,        // rounded, null if no verifications
  "by_discrepancy_type": { [type: string]: number },
  "flagged_rate": number                   // share of verifications with a non-"accurate" type (0–1)
}

// 500 { "error": string }`,
    description:
      "Aggregate counts across cached sources and stored verifications, for a dashboard or health-at-a-glance view.",
  },
  {
    method: "GET",
    path: "/api/health",
    request: `curl /api/health`,
    response: `// 200 (ok) or 503 (degraded)
{
  "status": "ok" | "degraded",
  "checks": {
    "database": boolean,
    "anthropic_key_present": boolean,
    "voyage_key_present": boolean
  },
  "timestamp": string             // ISO timestamp
}`,
    description:
      "Liveness and dependency check. 200 / status \"ok\" when the database is reachable and required API keys are present; otherwise 503 / status \"degraded\".",
  },
];
