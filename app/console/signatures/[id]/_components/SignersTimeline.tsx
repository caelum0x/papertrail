"use client";

import type { SignatureSigner } from "@/lib/signatures/types";
import { currentSigner } from "@/lib/signatures/types";
import { SignerStatusBadge, formatDateTime } from "@/components/signatures/ui";

interface SignersTimelineProps {
  signers: SignatureSigner[];
  // The user id whose turn it currently is (null if none / completed).
}

// Vertical ordered timeline of signers. The signer whose turn it is is
// highlighted; signed signers show their timestamp.
export function SignersTimeline({ signers }: SignersTimelineProps) {
  const active = currentSigner(signers);

  if (signers.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-ink/10 bg-white p-6 text-center text-sm text-ink/40">
        No signers have been added to this request yet.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-ink/10 bg-white p-5">
      <h2 className="text-sm font-semibold text-ink">Signers</h2>
      <ol className="mt-4 space-y-0">
        {signers.map((signer, i) => {
          const isActive = active?.id === signer.id;
          const isLast = i === signers.length - 1;
          return (
            <li key={signer.id} className="relative flex gap-3 pb-5">
              {!isLast ? (
                <span className="absolute left-[11px] top-6 h-full w-px bg-ink/10" />
              ) : null}
              <span
                className={`z-10 mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium ${
                  signer.status === "signed"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : isActive
                      ? "border-amber-300 bg-amber-50 text-amber-700"
                      : "border-ink/10 bg-paper text-ink/40"
                }`}
              >
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-ink/80">
                    {signer.userName || signer.userEmail || signer.userId.slice(0, 8)}
                  </span>
                  <SignerStatusBadge status={signer.status} />
                  {isActive ? (
                    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                      Current turn
                    </span>
                  ) : null}
                </div>
                {signer.userName && signer.userEmail ? (
                  <p className="text-xs text-ink/40">{signer.userEmail}</p>
                ) : null}
                <p className="mt-0.5 text-xs text-ink/40">
                  {signer.signedAt
                    ? `Signed ${formatDateTime(signer.signedAt)}`
                    : "Awaiting signature"}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
