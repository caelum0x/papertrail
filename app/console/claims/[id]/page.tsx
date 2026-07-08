"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  apiFetch,
  type ClaimDto,
  type VerificationDto,
} from "@/components/claims/api";
import { StatusBadge } from "@/components/claims/StatusBadge";
import { Breadcrumb } from "../_components/Breadcrumb";
import { ClaimDetailCard } from "../_components/ClaimDetailCard";
import { ClaimActions } from "../_components/ClaimActions";
import { VerificationHistory } from "../_components/VerificationHistory";
import { ClaimNotFound } from "../_components/ClaimNotFound";

export default function ClaimDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id;

  const [claim, setClaim] = useState<ClaimDto | null>(null);
  const [verifications, setVerifications] = useState<VerificationDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingStatus, setSavingStatus] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

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
        // History is non-critical — show the claim even if history fails.
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

  async function onChangeStatus(status: string) {
    if (!id) return;
    setSavingStatus(true);
    setActionError(null);
    try {
      const res = await apiFetch<ClaimDto>(`/api/claims/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      setClaim(res.data);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Failed to update status."
      );
    } finally {
      setSavingStatus(false);
    }
  }

  async function onDelete() {
    if (!id) return;
    if (!window.confirm("Delete this claim? This cannot be undone.")) return;
    setDeleting(true);
    setActionError(null);
    try {
      await apiFetch<{ deleted: boolean }>(`/api/claims/${id}`, {
        method: "DELETE",
      });
      router.push("/console/claims");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to delete.");
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <div className="p-8 text-center text-sm text-ink/40">Loading claim...</div>
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
      <Breadcrumb leaf="Detail" />

      <div className="mt-2 flex items-start justify-between gap-4">
        <h1 className="text-xl font-semibold text-ink/80">Claim</h1>
        <StatusBadge status={claim.status} />
      </div>

      <ClaimDetailCard claim={claim} />

      <ClaimActions
        status={claim.status}
        savingStatus={savingStatus}
        deleting={deleting}
        actionError={actionError}
        onChangeStatus={(s) => void onChangeStatus(s)}
        onDelete={() => void onDelete()}
      />

      <VerificationHistory verifications={verifications} />

      <div className="mt-4">
        <Link
          href={`/console/claims/${claim.id}/activity`}
          className="text-sm text-accent hover:underline"
        >
          View full activity timeline →
        </Link>
      </div>
    </div>
  );
}
