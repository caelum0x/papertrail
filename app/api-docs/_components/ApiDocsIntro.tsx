export function ApiDocsIntro() {
  return (
    <>
      <h1 className="text-2xl font-semibold text-ink/90">API</h1>
      <p className="mt-3 text-sm leading-relaxed text-ink/70">
        PaperTrail exposes a small JSON HTTP API. All responses are JSON. Errors return a{" "}
        <code className="rounded bg-ink/5 px-1 py-0.5 font-mono text-xs">{"{ \"error\": string }"}</code>{" "}
        body with an appropriate HTTP status. Replace{" "}
        <code className="rounded bg-ink/5 px-1 py-0.5 font-mono text-xs">your-deployment.vercel.app</code>{" "}
        with your host (or use a relative path from the same origin).
      </p>

      <div className="mt-6 rounded-lg border border-yellow-200 bg-yellow-50 p-4 text-sm leading-relaxed text-yellow-900">
        <strong>Hackathon demo.</strong> This is a demo build, not a hardened production
        service. There is no auth, response shapes may change, and the{" "}
        <code className="rounded bg-yellow-100 px-1 py-0.5 font-mono text-xs">POST /api/verify*</code>{" "}
        endpoints are rate-limited per IP. When the server runs with{" "}
        <code className="rounded bg-yellow-100 px-1 py-0.5 font-mono text-xs">DEMO_MODE=true</code>,
        retrieval reads only from the pre-cached <code className="font-mono text-xs">sources</code>{" "}
        table and never live-fetches PubMed or ClinicalTrials.gov — so claims outside the
        cached demo set return{" "}
        <code className="rounded bg-yellow-100 px-1 py-0.5 font-mono text-xs">no_support_found</code>.
      </div>
    </>
  );
}
