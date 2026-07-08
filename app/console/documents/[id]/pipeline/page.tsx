"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { apiFetch } from "@/components/documents/api";
import type { DocumentDetail, DocumentPage } from "@/lib/documents/types";
import type { ExtractionJob, PipelineSummary } from "@/lib/ingestion/pipeline";
import type { DocumentClaim } from "@/lib/ingestion/claimExtraction";
import { DocumentBreadcrumb } from "../../_components/DocumentBreadcrumb";
import { ExtractionStatus } from "../../_components/ExtractionStatus";
import { CandidateClaims } from "../../_components/CandidateClaims";
import { PagesViewer } from "../../_components/PagesViewer";
import { DocumentNotFound } from "../../_components/DocumentNotFound";

interface PagesResult {
  pages: DocumentPage[];
  latest_job: ExtractionJob | null;
}

export default function DocumentPipelinePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id;

  const [doc, setDoc] = useState<DocumentDetail | null>(null);
  const [pages, setPages] = useState<DocumentPage[]>([]);
  const [job, setJob] = useState<ExtractionJob | null>(null);
  const [claims, setClaims] = useState<DocumentClaim[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [extracting, setExtracting] = useState(false);
  const [extractingClaims, setExtractingClaims] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    const [detailRes, pagesRes, claimsRes] = await Promise.all([
      apiFetch<DocumentDetail>(`/api/documents/${id}`),
      apiFetch<PagesResult>(`/api/documents/${id}/pages`),
      apiFetch<DocumentClaim[]>(`/api/documents/${id}/claims`),
    ]);
    if (!detailRes.ok || !detailRes.data) {
      setError(detailRes.error ?? "Could not load document.");
      setDoc(null);
    } else {
      setDoc(detailRes.data);
      setPages(pagesRes.ok ? pagesRes.data?.pages ?? [] : []);
      setJob(pagesRes.ok ? pagesRes.data?.latest_job ?? null : null);
      setClaims(claimsRes.ok ? claimsRes.data ?? [] : []);
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const runExtraction = useCallback(async () => {
    if (!id) return;
    setExtracting(true);
    setActionError(null);
    const res = await apiFetch<PipelineSummary>(`/api/documents/${id}/extract`, {
      method: "POST",
    });
    setExtracting(false);
    if (!res.ok) {
      setActionError(
        res.status === 403
          ? "You don't have permission to run extraction."
          : res.error ?? "Extraction failed."
      );
      return;
    }
    void load();
  }, [id, load]);

  const runClaimExtraction = useCallback(async () => {
    if (!id) return;
    setExtractingClaims(true);
    setActionError(null);
    const res = await apiFetch<DocumentClaim[]>(
      `/api/documents/${id}/extract-claims`,
      { method: "POST" }
    );
    setExtractingClaims(false);
    if (!res.ok) {
      setActionError(
        res.status === 403
          ? "You don't have permission to extract claims."
          : res.error ?? "Claim extraction failed."
      );
      return;
    }
    setClaims(res.data ?? []);
  }, [id]);

  const verifyClaim = useCallback(
    async (claim: DocumentClaim) => {
      setVerifyingId(claim.id);
      setActionError(null);
      const res = await apiFetch<{ id: string }>("/api/claims", {
        method: "POST",
        body: JSON.stringify({ text: claim.text }),
      });
      setVerifyingId(null);
      if (!res.ok || !res.data) {
        setActionError(
          res.status === 403
            ? "You don't have permission to create claims."
            : res.error ?? "Could not start verification."
        );
        return;
      }
      router.push(`/console/claims/${res.data.id}`);
    },
    [router]
  );

  if (loading) {
    return <div className="text-sm text-ink/40">Loading pipeline...</div>;
  }

  if (error || !doc) {
    return <DocumentNotFound message={error ?? "Document not found."} />;
  }

  return (
    <div>
      <DocumentBreadcrumb
        leaf="Pipeline"
        documentId={doc.id}
        filename={doc.filename}
      />

      <h1 className="mt-2 text-2xl font-semibold text-ink/80 break-all">
        Processing pipeline
      </h1>

      <ExtractionStatus
        job={job}
        extracting={extracting}
        extractingClaims={extractingClaims}
        actionError={actionError}
        onRunExtraction={runExtraction}
        onExtractClaims={runClaimExtraction}
      />

      <CandidateClaims
        claims={claims}
        verifyingId={verifyingId}
        onVerify={verifyClaim}
      />

      <PagesViewer pages={pages} />
    </div>
  );
}
