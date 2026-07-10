import type { AuditedClaim } from "@/lib/guidelineAudit/schemas";
import { VerdictBadge } from "./VerdictBadge";

// The claim-by-claim audit table. One row per extracted efficacy claim, showing:
//   - the claim (Claude's standalone restatement) + the exact grounded source sentence
//   - the deterministic verdict badge + trust score
//   - the primary-source finding it was judged against ("what the source actually found")
//
// Pure presentation: it renders the audit result, does no fetching of its own.

function TrustScore({ score }: { score: number }) {
  const tone =
    score >= 75
      ? "text-emerald-600"
      : score >= 50
        ? "text-amber-600"
        : "text-red-600";
  return <span className={`font-mono text-sm font-semibold ${tone}`}>{score}</span>;
}

function ClaimRow({ claim }: { claim: AuditedClaim }) {
  return (
    <tr className="border-b border-ink/5 align-top">
      <td className="px-4 py-4">
        <p className="text-sm font-medium text-ink/80">{claim.text}</p>
        {claim.intervention ? (
          <p className="mt-1 text-xs text-ink/40">Intervention: {claim.intervention}</p>
        ) : null}
        {/* The exact sentence located verbatim in the pasted document — the citation
            trail back to what the document actually said. */}
        <blockquote className="mt-2 border-l-2 border-ink/10 pl-3 text-xs italic text-ink/50">
          “{claim.groundedSpan.text}”
          {claim.groundedSpan.status === "approximate" ? (
            <span className="ml-1 not-italic text-ink/30">(whitespace-normalized match)</span>
          ) : null}
        </blockquote>
      </td>
      <td className="px-4 py-4 whitespace-nowrap">
        <div className="flex flex-col items-start gap-1">
          <VerdictBadge verdict={claim.verdict} />
          <TrustScore score={claim.trustScore} />
        </div>
      </td>
      <td className="px-4 py-4">
        {claim.pooledFinding ? (
          <div className="text-sm text-ink/70">
            <p className="font-mono text-xs">
              {claim.pooledFinding.measure} {claim.pooledFinding.point}{" "}
              <span className="text-ink/40">
                (95% CI {claim.pooledFinding.ciLower}–{claim.pooledFinding.ciUpper})
              </span>
            </p>
            <p className="mt-1 text-xs text-ink/40">
              {claim.pooledFinding.studies} primary{" "}
              {claim.pooledFinding.studies === 1 ? "source" : "sources"}
            </p>
          </div>
        ) : (
          <p className="text-xs text-ink/40">No confident primary source found</p>
        )}
        <p className="mt-2 text-xs text-ink/50">{claim.explanation}</p>
      </td>
    </tr>
  );
}

export function AuditTable({ claims }: { claims: AuditedClaim[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-ink/10">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-ink/10 bg-ink/[0.02] text-left text-xs font-medium uppercase tracking-wide text-ink/40">
            <th className="px-4 py-3">Claim &amp; source sentence</th>
            <th className="px-4 py-3">Verdict</th>
            <th className="px-4 py-3">Primary-source finding</th>
          </tr>
        </thead>
        <tbody>
          {claims.map((claim, i) => (
            <ClaimRow key={`${claim.groundedSpan.start}-${i}`} claim={claim} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
