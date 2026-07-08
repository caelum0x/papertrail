import type { VerificationDto } from "@/components/claims/api";
import { trustBand, trustBandClasses, trustBandLabel } from "@/lib/trustBand";

// Renders the verification history for a claim. Shared by the detail page and
// the activity sub-page. `heading` is optional so callers can supply their own.

function VerificationRow({ v }: { v: VerificationDto }) {
  const score = v.trust_score ?? 0;
  const band = trustBand(score);
  return (
    <li className="rounded-lg border border-ink/15 bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <span
          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${trustBandClasses(
            band
          )}`}
        >
          {v.trust_score !== null
            ? `${v.trust_score} · ${trustBandLabel(band)}`
            : "Not scored"}
        </span>
        <span className="text-xs text-ink/40">
          {new Date(v.created_at).toLocaleString()}
        </span>
      </div>
      {v.discrepancy_type ? (
        <p className="mt-2 text-xs text-ink/60">
          Discrepancy: {v.discrepancy_type.replace(/_/g, " ")}
        </p>
      ) : null}
      {v.explanation ? (
        <p className="mt-1 text-sm text-ink/70">{v.explanation}</p>
      ) : null}
    </li>
  );
}

interface VerificationHistoryProps {
  verifications: VerificationDto[];
  heading?: string;
}

export function VerificationHistory({
  verifications,
  heading = "Verification history",
}: VerificationHistoryProps) {
  return (
    <div className="mt-6">
      <h2 className="text-sm font-medium text-ink/70">{heading}</h2>
      {verifications.length === 0 ? (
        <div className="mt-3 rounded-lg border border-ink/15 bg-white p-6 text-center text-sm text-ink/40">
          No verifications yet for this claim.
        </div>
      ) : (
        <ul className="mt-3 space-y-3">
          {verifications.map((v) => (
            <VerificationRow key={v.id} v={v} />
          ))}
        </ul>
      )}
    </div>
  );
}
