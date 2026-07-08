"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { FeatureFlag } from "@/lib/flags/types";
import { deleteFlag } from "@/components/flags/api";
import { EnabledPill, KeyChip, formatTime } from "@/components/flags/ui";

// Detail-page header: key, description, status, back link, and a guarded delete.
export function FlagHeader({ flag }: { flag: FeatureFlag }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onDelete() {
    setDeleting(true);
    setError(null);
    const res = await deleteFlag(flag.id);
    setDeleting(false);
    if (!res.success) {
      setError(res.error ?? "Failed to delete flag.");
      return;
    }
    router.push("/console/admin/flags");
  }

  return (
    <div className="border-b border-ink/10 pb-4">
      <Link
        href="/console/admin/flags"
        className="text-xs text-ink/50 hover:text-accent"
      >
        ← Back to feature flags
      </Link>
      <div className="mt-2 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <KeyChip value={flag.key} />
            <EnabledPill enabled={flag.enabled} />
          </div>
          {flag.description && (
            <p className="mt-2 text-sm text-ink/60">{flag.description}</p>
          )}
          <p className="mt-1 text-[11px] text-ink/40">
            Created {formatTime(flag.createdAt)}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          {confirming ? (
            <div className="flex items-center gap-2">
              <button
                onClick={onDelete}
                disabled={deleting}
                className="rounded-md border border-red-300 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100 disabled:opacity-50"
              >
                {deleting ? "Deleting…" : "Confirm delete"}
              </button>
              <button
                onClick={() => setConfirming(false)}
                disabled={deleting}
                className="rounded-md border border-ink/10 px-3 py-1.5 text-xs text-ink/60 hover:bg-paper"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirming(true)}
              className="rounded-md border border-ink/10 px-3 py-1.5 text-xs text-ink/60 hover:bg-paper"
            >
              Delete flag
            </button>
          )}
          {error && <p className="text-[11px] text-red-600">{error}</p>}
        </div>
      </div>
    </div>
  );
}
