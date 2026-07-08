"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, type ClaimDto } from "@/components/claims/api";
import { Breadcrumb } from "../_components/Breadcrumb";
import { NewClaimForm } from "../_components/NewClaimForm";

export default function NewClaimPage() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [projectId, setProjectId] = useState("");
  const [citedSourceUrl, setCitedSourceUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) {
      setError("Claim text is required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = { text: text.trim() };
      if (projectId.trim()) payload.project_id = projectId.trim();
      if (citedSourceUrl.trim()) payload.cited_source_url = citedSourceUrl.trim();

      const res = await apiFetch<ClaimDto>("/api/claims", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      const created = res.data;
      if (created) {
        router.push(`/console/claims/${created.id}`);
      } else {
        router.push("/console/claims");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit claim.");
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <Breadcrumb leaf="New" />

      <h1 className="mt-2 text-2xl font-semibold text-ink/80">Submit a claim</h1>
      <p className="mt-1 text-sm text-ink/40">
        Enter an efficacy claim to track and verify against its primary source.
      </p>

      <NewClaimForm
        text={text}
        projectId={projectId}
        citedSourceUrl={citedSourceUrl}
        submitting={submitting}
        error={error}
        onTextChange={setText}
        onProjectIdChange={setProjectId}
        onCitedSourceUrlChange={setCitedSourceUrl}
        onSubmit={onSubmit}
      />
    </div>
  );
}
