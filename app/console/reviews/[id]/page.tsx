"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  fetchReview,
  submitDecision,
} from "@/components/reviews/reviewClient";
import type { ReviewWithPeople } from "@/lib/reviews/types";
import {
  APPROVER_ROLES,
  useActiveOrgRole,
} from "../_components/useActiveOrgRole";
import { ReviewSummary } from "../_components/ReviewSummary";
import { DecisionPanel } from "../_components/DecisionPanel";
import { StateBlock } from "../_components/StateBlock";

export default function ReviewDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const role = useActiveOrgRole();

  const [review, setReview] = useState<ReviewWithPeople | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    const result = await fetchReview(id);
    if (result.error || !result.data) {
      setError(result.error ?? "Review not found.");
      setReview(null);
    } else {
      setReview(result.data);
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const onDecide = useCallback(
    async (decision: "approved" | "rejected") => {
      if (!id) return;
      setSubmitting(true);
      setActionError(null);
      const result = await submitDecision(id, decision, comment);
      if (result.error || !result.data) {
        setActionError(result.error ?? "Failed to submit decision.");
      } else {
        setReview(result.data);
        setComment("");
      }
      setSubmitting(false);
    },
    [id, comment]
  );

  const canApprove = role !== null && APPROVER_ROLES.has(role);

  return (
    <div className="max-w-3xl">
      <Link
        href="/console/reviews"
        className="text-sm text-accent hover:underline"
      >
        ← Back to reviews
      </Link>

      {loading ? (
        <div className="mt-6 rounded-lg border border-ink/15 bg-white">
          <StateBlock kind="loading" message="Loading review..." />
        </div>
      ) : error ? (
        <div className="mt-6 rounded-lg border border-ink/15 bg-white">
          <StateBlock kind="error" message={error} onRetry={load} />
        </div>
      ) : review ? (
        <div className="mt-6 space-y-4">
          <ReviewSummary review={review} />
          <DecisionPanel
            review={review}
            canApprove={canApprove}
            comment={comment}
            submitting={submitting}
            actionError={actionError}
            onCommentChange={setComment}
            onDecide={onDecide}
          />
        </div>
      ) : null}
    </div>
  );
}
