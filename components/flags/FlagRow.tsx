"use client";

import Link from "next/link";
import type { FeatureFlag } from "@/lib/flags/types";
import { EnabledPill, KeyChip, relativeTime } from "@/components/flags/ui";

// One row in the flag list table. Presentational only — links to the detail
// page where rollout and rules are edited.
export function FlagRow({ flag }: { flag: FeatureFlag }) {
  return (
    <Link
      href={`/console/admin/flags/${flag.id}`}
      className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-4 border-b border-ink/10 px-3 py-3 text-sm transition-colors hover:bg-paper"
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <KeyChip value={flag.key} />
        </div>
        {flag.description && (
          <p className="mt-1 truncate text-xs text-ink/50">
            {flag.description}
          </p>
        )}
      </div>
      <div className="w-24 text-right tabular-nums text-xs text-ink/60">
        {flag.rolloutPercent}% rollout
      </div>
      <div className="w-16 text-right text-xs text-ink/50">
        {flag.rules.length} {flag.rules.length === 1 ? "rule" : "rules"}
      </div>
      <div className="flex w-32 items-center justify-end gap-3">
        <EnabledPill enabled={flag.enabled} />
        <span className="text-[11px] text-ink/40">
          {relativeTime(flag.createdAt)}
        </span>
      </div>
    </Link>
  );
}
