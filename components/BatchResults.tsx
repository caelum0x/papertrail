"use client";

import { useState } from "react";
import { VerificationView, EffectSizeCheck } from "@/components/VerificationView";
import { GroundedSpan } from "@/lib/grounding";

export interface BatchResultItem {
  claim: string;
  status: "verified" | "no_support_found" | "error";
  verification_id?: string | null;
  source?: {
    title: string | null;
    url: string;
    source_type: string;
    external_id?: string;
    raw_text: string;
  };
  verification?: {
    discrepancy_type: string;
    trust_score: number;
    explanation: string;
    flagged_spans: GroundedSpan[];
  };
  effect_size_check?: EffectSizeCheck;
}

export interface BatchResultsProps {
  results: BatchResultItem[];
}

const DISCREPANCY_LABELS: Record<string, string> = {
  accurate: "Accurate",
  magnitude_overstated: "Magnitude overstated",
  population_overgeneralized: "Population overgeneralized",
  caveat_dropped: "Caveat dropped",
  no_support_found: "No support found",
};

function badgeColor(score: number): string {
  if (score >= 90) return "bg-green-100 text-green-800 border-green-300";
  if (score >= 60) return "bg-yellow-100 text-yellow-800 border-yellow-300";
  return "bg-red-100 text-red-800 border-red-300";
}

/** Verified item: a collapsible card with a trust badge + discrepancy label header
 *  and the full VerificationView underneath when expanded. */
function VerifiedCard({ item, index }: { item: BatchResultItem; index: number }) {
  const [open, setOpen] = useState(false);
  const verification = item.verification;
  if (!verification) return null;

  return (
    <div className="rounded-lg border border-ink/10 bg-white">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start justify-between gap-3 p-4 text-left"
        aria-expanded={open}
      >
        <div className="min-w-0">
          <div className="text-xs font-medium uppercase tracking-wide text-ink/40">
            Claim {index + 1}
          </div>
          <p className="mt-1 text-sm text-ink/80">{item.claim}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span
            className={`rounded-full border px-2 py-0.5 text-xs font-medium ${badgeColor(verification.trust_score)}`}
          >
            {verification.trust_score} ·{" "}
            {DISCREPANCY_LABELS[verification.discrepancy_type] ?? verification.discrepancy_type}
          </span>
          <span className="text-xs text-ink/40">{open ? "Hide" : "Details"}</span>
        </div>
      </button>

      {open && (
        <div className="border-t border-ink/10 p-4">
          <VerificationView
            claim={item.claim}
            source={item.source ?? null}
            verification={verification}
            effectSizeCheck={item.effect_size_check}
            idNamespace={`b${index}`}
          />
        </div>
      )}
    </div>
  );
}

/** Compact single row for claims with no confident source or an error. */
function CompactRow({ item, index }: { item: BatchResultItem; index: number }) {
  const isError = item.status === "error";
  const label = isError ? "Error" : "No support found";
  const badge = isError
    ? "bg-red-100 text-red-800 border-red-300"
    : "bg-ink/5 text-ink/60 border-ink/15";
  const note = isError
    ? "Something went wrong verifying this claim. It was skipped so the rest of the batch could finish."
    : "No confident matching primary source was found. This isn't a judgment on the claim — it couldn't be verified against a retrievable source.";

  return (
    <div className="rounded-lg border border-ink/10 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-medium uppercase tracking-wide text-ink/40">
            Claim {index + 1}
          </div>
          <p className="mt-1 text-sm text-ink/80">{item.claim}</p>
        </div>
        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium ${badge}`}>
          {label}
        </span>
      </div>
      <p className="mt-2 text-xs text-ink/50">{note}</p>
    </div>
  );
}

export function BatchResults({ results }: BatchResultsProps) {
  if (results.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      {results.map((item, index) =>
        item.status === "verified" ? (
          <VerifiedCard key={index} item={item} index={index} />
        ) : (
          <CompactRow key={index} item={item} index={index} />
        )
      )}
    </div>
  );
}
