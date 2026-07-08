import type { DocumentClaim } from "@/lib/ingestion/claimExtraction";

// List of AI-extracted candidate claims with a per-row "verify" action that
// promotes the claim into the verification pipeline.

interface CandidateClaimsProps {
  claims: DocumentClaim[];
  verifyingId: string | null;
  onVerify: (claim: DocumentClaim) => void;
}

export function CandidateClaims({
  claims,
  verifyingId,
  onVerify,
}: CandidateClaimsProps) {
  return (
    <div className="mt-6 bg-white border border-ink/15 rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-ink/15">
        <h2 className="text-sm font-medium text-ink/70">Candidate claims</h2>
        <span className="text-xs text-ink/40">{claims.length} found</span>
      </div>
      {claims.length === 0 ? (
        <div className="px-5 py-8 text-center text-sm text-ink/40">
          No claims extracted yet. Run &ldquo;Extract claims&rdquo; above to pull
          verifiable statements from this document.
        </div>
      ) : (
        <ul className="divide-y divide-ink/10">
          {claims.map((claim) => (
            <li
              key={claim.id}
              className="px-5 py-4 flex items-start justify-between gap-4"
            >
              <div className="min-w-0">
                <p className="text-sm text-ink/80">{claim.text}</p>
                <div className="mt-1 text-xs text-ink/40">
                  {claim.page_number ? `Page ${claim.page_number} · ` : ""}
                  {claim.extracted_by === "llm" ? "AI-extracted" : "Manual"}
                </div>
              </div>
              <button
                onClick={() => onVerify(claim)}
                disabled={verifyingId === claim.id}
                className="shrink-0 rounded bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              >
                {verifyingId === claim.id ? "Starting..." : "Verify this claim"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
