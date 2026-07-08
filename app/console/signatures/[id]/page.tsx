"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import type { SignatureRequestDetail } from "@/lib/signatures/types";
import {
  fetchRequest,
  signRequest,
  cancelRequest,
  fetchCurrentUserId,
} from "@/components/signatures/api";
import { LoadingState, ErrorState } from "@/components/signatures/ui";
import {
  useActiveOrgRole,
  canManageSignatures,
} from "../_components/useActiveOrgRole";
import { RequestHeader } from "./_components/RequestHeader";
import { SignersTimeline } from "./_components/SignersTimeline";
import { SignPanel } from "./_components/SignPanel";
import { CertificatePanel } from "./_components/CertificatePanel";

export default function SignatureRequestDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const role = useActiveOrgRole();
  const canManage = canManageSignatures(role);

  const [detail, setDetail] = useState<SignatureRequestDetail | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    const [result, userId] = await Promise.all([
      fetchRequest(id),
      fetchCurrentUserId(),
    ]);
    if (result.error || !result.data) {
      setError(result.error ?? "Signature request not found.");
      setDetail(null);
    } else {
      setDetail(result.data);
    }
    setCurrentUserId(userId);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const onSign = useCallback(
    async (mfaMethod: string) => {
      if (!id) return;
      setSubmitting(true);
      setActionError(null);
      const result = await signRequest(id, mfaMethod);
      if (result.error || !result.data) {
        setActionError(result.error ?? "Failed to sign request.");
      } else {
        setDetail(result.data);
      }
      setSubmitting(false);
    },
    [id]
  );

  const onCancel = useCallback(async () => {
    if (!id) return;
    setCancelling(true);
    setActionError(null);
    const result = await cancelRequest(id);
    if (result.error || !result.data) {
      setActionError(result.error ?? "Failed to cancel request.");
    } else {
      setDetail(result.data);
    }
    setCancelling(false);
  }, [id]);

  return (
    <div className="max-w-3xl">
      <Link
        href="/console/signatures"
        className="text-sm text-accent hover:underline"
      >
        ← Back to signatures
      </Link>

      {loading ? (
        <div className="mt-6 rounded-lg border border-ink/10 bg-white">
          <LoadingState label="Loading signature request…" />
        </div>
      ) : error ? (
        <div className="mt-6">
          <ErrorState message={error} onRetry={load} />
        </div>
      ) : detail ? (
        <div className="mt-6 space-y-4">
          <RequestHeader
            request={detail.request}
            canCancel={canManage}
            cancelling={cancelling}
            onCancel={onCancel}
          />
          <SignersTimeline signers={detail.signers} />
          {canManage ? (
            <SignPanel
              detail={detail}
              currentUserId={currentUserId}
              submitting={submitting}
              actionError={actionError}
              onSign={onSign}
            />
          ) : null}
          <CertificatePanel
            certificate={detail.certificate}
            isCompleted={detail.request.status === "completed"}
          />
        </div>
      ) : null}
    </div>
  );
}
