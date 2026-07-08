// Structured logging. Never logs claim text or API keys - only metadata
// needed to debug latency/failures without exposing potentially unpublished
// research content in logs.

export function logEvent(event: string, fields: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ event, ts: new Date().toISOString(), ...fields }));
}
