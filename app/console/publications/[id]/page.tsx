"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  fetchPublication,
  fetchPublicationClaims,
  fetchReadiness,
  fetchMlrReviews,
  attachClaims,
  submitMlrReview,
} from "../client";
import type {
  MlrDecision,
  MlrReview,
  MlrRole,
  PublicationClaim,
  PublicationReadiness,
  PublicationWithCounts,
} from "@/app/api/publications/lib/types";
import { ReadinessPanel } from "../_components/ReadinessPanel";
import { AttachClaims } from "../_components/AttachClaims";
import { AttachedClaims } from "../_components/AttachedClaims";
import { MlrReviewPanel } from "../_components/MlrReviewPanel";

export default function PublicationDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const [publication, setPublication] =
    useState<PublicationWithCounts | null>(null);
  const [pubError, setPubError] = useState<string | null>(null);

  const [claims, setClaims] = useState<PublicationClaim[]>([]);
  const [claimsLoading, setClaimsLoading] = useState(true);
  const [claimsError, setClaimsError] = useState<string | null>(null);

  const [readiness, setReadiness] = useState<PublicationReadiness | null>(null);

  const [reviews, setReviews] = useState<MlrReview[]>([]);

  const [attachIds, setAttachIds] = useState("");
  const [attaching, setAttaching] = useState(false);
  const [attachMsg, setAttachMsg] = useState<string | null>(null);

  const [mlrRole, setMlrRole] = useState<MlrRole>("medical");
  const [mlrDecision, setMlrDecision] = useState<MlrDecision>("approved");
  const [mlrComments, setMlrComments] = useState("");
  const [submittingMlr, setSubmittingMlr] = useState(false);
  const [mlrError, setMlrError] = useState<string | null>(null);

  const loadPublication = useCallback(async () => {
    if (!id) return;
    const result = await fetchPublication(id);
    if (result.error || !result.data) {
      setPubError(result.error ?? "Publication not found.");
    } else {
      setPublication(result.data);
      setPubError(null);
    }
  }, [id]);

  const loadClaims = useCallback(async () => {
    if (!id) return;
    setClaimsLoading(true);
    setClaimsError(null);
    const result = await fetchPublicationClaims(id);
    if (result.error) {
      setClaimsError(result.error);
      setClaims([]);
    } else {
      setClaims(result.data ?? []);
    }
    setClaimsLoading(false);
  }, [id]);

  const loadReadiness = useCallback(async () => {
    if (!id) return;
    const result = await fetchReadiness(id);
    if (!result.error && result.data) {
      setReadiness(result.data);
    }
  }, [id]);

  const loadReviews = useCallback(async () => {
    if (!id) return;
    const result = await fetchMlrReviews(id);
    if (!result.error && result.data) {
      setReviews(result.data);
    }
  }, [id]);

  useEffect(() => {
    loadPublication();
  }, [loadPublication]);
  useEffect(() => {
    loadClaims();
  }, [loadClaims]);
  useEffect(() => {
    loadReadiness();
  }, [loadReadiness]);
  useEffect(() => {
    loadReviews();
  }, [loadReviews]);

  const onAttach = useCallback(async () => {
    if (!id) return;
    const ids = attachIds
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (ids.length === 0) {
      setAttachMsg("Enter at least one claim id.");
      return;
    }
    setAttaching(true);
    setAttachMsg(null);
    const result = await attachClaims(id, ids);
    setAttaching(false);
    if (result.error || !result.data) {
      setAttachMsg(result.error ?? "Failed to attach claims.");
      return;
    }
    setAttachMsg(
      `Attached ${result.data.attached} claim(s)` +
        (result.data.skipped > 0
          ? `, skipped ${result.data.skipped} (unknown or already attached).`
          : ".")
    );
    setAttachIds("");
    loadClaims();
    loadReadiness();
    loadPublication();
  }, [id, attachIds, loadClaims, loadReadiness, loadPublication]);

  const onSubmitMlr = useCallback(async () => {
    if (!id) return;
    setSubmittingMlr(true);
    setMlrError(null);
    const result = await submitMlrReview(id, {
      role: mlrRole,
      decision: mlrDecision,
      comments: mlrComments.trim() ? mlrComments.trim() : null,
    });
    setSubmittingMlr(false);
    if (result.error || !result.data) {
      setMlrError(result.error ?? "Failed to submit MLR review.");
      return;
    }
    setMlrComments("");
    loadReviews();
    loadReadiness();
  }, [id, mlrRole, mlrDecision, mlrComments, loadReviews, loadReadiness]);

  if (pubError) {
    return (
      <div className="max-w-3xl">
        <Link
          href="/console/publications"
          className="text-sm text-accent hover:underline"
        >
          ← Back to publications
        </Link>
        <div className="mt-6 rounded-lg border border-ink/15 bg-white p-8 text-center">
          <p className="text-sm text-red-700">{pubError}</p>
          <button
            onClick={loadPublication}
            className="mt-3 text-sm text-accent hover:underline"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <Link
        href="/console/publications"
        className="text-sm text-accent hover:underline"
      >
        ← Back to publications
      </Link>

      <div className="mt-4 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-ink/80">
            {publication?.title ?? "Publication"}
          </h1>
          {publication ? (
            <p className="mt-1 text-sm text-ink/40">
              {publication.type.replace("_", " ")}
              {publication.targetJournal
                ? ` · ${publication.targetJournal}`
                : ""}
              {` · ${publication.status.replace("_", " ")}`}
              {` · stage: ${publication.stage.replace("_", " ")}`}
            </p>
          ) : null}
        </div>
        {id ? (
          <Link
            href={`/console/publications/${id}/activity`}
            className="shrink-0 text-xs font-medium text-accent hover:underline"
          >
            MLR activity
          </Link>
        ) : null}
      </div>

      {readiness ? <ReadinessPanel readiness={readiness} /> : null}

      <AttachClaims
        value={attachIds}
        attaching={attaching}
        message={attachMsg}
        onChange={setAttachIds}
        onAttach={onAttach}
      />

      <AttachedClaims
        claims={claims}
        loading={claimsLoading}
        error={claimsError}
        onRetry={loadClaims}
      />

      <MlrReviewPanel
        role={mlrRole}
        decision={mlrDecision}
        comments={mlrComments}
        submitting={submittingMlr}
        error={mlrError}
        reviews={reviews}
        onRoleChange={setMlrRole}
        onDecisionChange={setMlrDecision}
        onCommentsChange={setMlrComments}
        onSubmit={onSubmitMlr}
      />
    </div>
  );
}
