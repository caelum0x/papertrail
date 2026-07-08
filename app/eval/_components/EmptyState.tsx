export function EmptyState() {
  return (
    <div className="rounded-lg border border-ink/10 bg-white p-6">
      <p className="text-sm text-ink/80">
        No accuracy numbers have been recorded yet.
      </p>
      <p className="mt-3 text-sm text-ink/60">
        Accuracy is measured against pinned-PMID labeled fixtures in{" "}
        <code className="rounded bg-ink/5 px-1 py-0.5 text-xs">
          tests/fixtures/demo-claims.json
        </code>{" "}
        — each fixture pins a real source by PubMed ID, an expected discrepancy type,
        and the exact substrings the verifier should flag. The harness scores the full
        extraction → verification → reconciliation pipeline deterministically against
        those labels.
      </p>
      <p className="mt-3 text-sm text-ink/60">
        Numbers appear here after running{" "}
        <code className="rounded bg-ink/5 px-1 py-0.5 text-xs">npm run eval</code>{" "}
        against a live database with the demo sources ingested (
        <code className="rounded bg-ink/5 px-1 py-0.5 text-xs">
          npm run ingest:test-set
        </code>
        ). Until then this page shows no metric rather than an invented one.
      </p>
    </div>
  );
}
