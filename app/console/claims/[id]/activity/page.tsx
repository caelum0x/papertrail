"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  apiFetch,
  type ClaimDto,
  type VerificationDto,
} from "@/components/claims/api";
import { StatusBadge } from "@/components/claims/StatusBadge";
import { VerificationHistory } from "../../_components/VerificationHistory";
import { ClaimNotFound } from "../../_components/ClaimNotFound";

// Activity timeline for a single claim: a focused view of every verification run
// against it. Uses the existing claim + verifications endpoints only.
export default function ClaimActivityPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const [claim, setClaim] = useState<ClaimDto | null>(null);
  const [verifications, setVerifications] = useState<VerificationDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const claimRes = await apiFetch<ClaimDto>(`/api/claims/${id}`);
      setClaim(claimRes.data);
      try {
        const verRes = await apiFetch<VerificationDto[]>(
          `/api/claims/${id}/verifications`
        );
        setVerifications(verRes.data ?? []);
      } catch {
        setVerifications([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load claim.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="p-8 text-center text-sm text-ink/40">
        Loading activity...
      </div>
    );
  }

  if (error || !claim) {
    return (
      <ClaimNotFound
        message={error ?? "Claim not found."}
        onRetry={() => void load()}
      />
    );
  }

  return (
    <div className="max-w-3xl">
      <div className="flex items-center gap-2 text-sm text-ink/40">
        <Link href="/console/claims" className="hover:text-accent">
          Claims
        </Link>
        <span>/</span>
        <Link href={`/console/claims/${claim.id}`} className="hover:text-accent">
          Detail
        </Link>
        <span>/</span>
        <span className="text-ink/60">Activity</span>
      </div>

      <div className="mt-2 flex items-start justify-between gap-4">
        <h1 className="text-xl font-semibold text-ink/80">Claim activity</h1>
        <StatusBadge status={claim.status} />
      </div>

      <p className="mt-2 line-clamp-2 text-sm text-ink/60">{claim.text}</p>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-ink/15 bg-white p-4">
          <div className="text-xs text-ink/40">Verification runs</div>
          <div className="mt-1 text-lg font-semibold text-ink/80">
            {verifications.length}
          </div>
        </div>
        <div className="rounded-lg border border-ink/15 bg-white p-4">
          <div className="text-xs text-ink/40">Last updated</div>
          <div className="mt-1 text-sm text-ink/70">
            {new Date(claim.updated_at).toLocaleString()}
          </div>
        </div>
      </div>

      <VerificationHistory
        verifications={verifications}
        heading="Timeline"
      />
    </div>
  );
}
