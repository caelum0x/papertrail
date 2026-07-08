"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { apiFetch } from "@/components/documents/api";
import type { DocumentDetail, DocumentPage } from "@/lib/documents/types";
import { DocumentHeader } from "../_components/DocumentHeader";
import { DocumentStats } from "../_components/DocumentStats";
import { ExtractedText } from "../_components/ExtractedText";
import { DocumentNotFound } from "../_components/DocumentNotFound";

interface TextResult {
  extracted_text: string | null;
  pages: DocumentPage[];
}

export default function DocumentDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id;

  const [doc, setDoc] = useState<DocumentDetail | null>(null);
  const [textData, setTextData] = useState<TextResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    const [detailRes, textRes] = await Promise.all([
      apiFetch<DocumentDetail>(`/api/documents/${id}`),
      apiFetch<TextResult>(`/api/documents/${id}/text`),
    ]);
    if (!detailRes.ok) {
      setError(detailRes.error ?? "Could not load document.");
      setDoc(null);
    } else {
      setDoc(detailRes.data);
      setTextData(textRes.ok ? textRes.data : null);
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const onDelete = useCallback(async () => {
    if (!id) return;
    if (!window.confirm("Delete this document? This cannot be undone.")) return;
    setDeleting(true);
    setDeleteError(null);
    const res = await apiFetch<{ deleted: boolean }>(`/api/documents/${id}`, {
      method: "DELETE",
    });
    setDeleting(false);
    if (!res.ok) {
      setDeleteError(
        res.status === 403
          ? "You don't have permission to delete documents."
          : res.error ?? "Delete failed."
      );
      return;
    }
    router.push("/console/documents");
  }, [id, router]);

  if (loading) {
    return <div className="text-sm text-ink/40">Loading document...</div>;
  }

  if (error || !doc) {
    return <DocumentNotFound message={error ?? "Document not found."} />;
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <Link href="/console/documents" className="text-sm text-accent">
          ← Back to documents
        </Link>
        <Link
          href={`/console/documents/${doc.id}/pipeline`}
          className="text-sm text-accent hover:underline"
        >
          Open pipeline →
        </Link>
      </div>

      <DocumentHeader doc={doc} deleting={deleting} onDelete={onDelete} />
      {deleteError ? (
        <p className="mt-2 text-sm text-red-600">{deleteError}</p>
      ) : null}

      <DocumentStats doc={doc} />

      <ExtractedText doc={doc} pages={textData?.pages ?? []} />
    </div>
  );
}
