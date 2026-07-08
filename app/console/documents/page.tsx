"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/components/documents/api";
import type { DocumentSummary } from "@/lib/documents/types";
import { UploadForm } from "./_components/UploadForm";
import { DocumentsTable } from "./_components/DocumentsTable";
import { DocumentsPagination } from "./_components/DocumentsPagination";

const PAGE_LIMIT = 20;

export default function DocumentsPage() {
  const [docs, setDocs] = useState<DocumentSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Upload form state.
  const [filename, setFilename] = useState("");
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  const load = useCallback(async (targetPage: number) => {
    setLoading(true);
    setError(null);
    const res = await apiFetch<DocumentSummary[]>(
      `/api/documents?page=${targetPage}&limit=${PAGE_LIMIT}`
    );
    if (!res.ok) {
      setError(res.error ?? "Could not load documents.");
      setDocs([]);
      setTotal(0);
    } else {
      setDocs(res.data ?? []);
      setTotal(res.meta?.total ?? 0);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load(page);
  }, [load, page]);

  const onUpload = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setFormError(null);
      setForbidden(false);
      if (!filename.trim() || !text.trim()) {
        setFormError("Filename and text are required.");
        return;
      }
      setSubmitting(true);
      const res = await apiFetch<DocumentSummary>("/api/documents/upload", {
        method: "POST",
        body: JSON.stringify({
          filename: filename.trim(),
          mime_type: "text/plain",
          text,
        }),
      });
      setSubmitting(false);
      if (!res.ok) {
        if (res.status === 403) setForbidden(true);
        setFormError(res.error ?? "Upload failed.");
        return;
      }
      setFilename("");
      setText("");
      setPage(1);
      void load(1);
    },
    [filename, text, load]
  );

  const totalPages = Math.max(1, Math.ceil(total / PAGE_LIMIT));

  return (
    <div>
      <h1 className="text-2xl font-semibold text-ink/80">Documents</h1>
      <p className="mt-1 text-sm text-ink/40">
        Upload source documents and view their extracted text.
      </p>

      <UploadForm
        filename={filename}
        text={text}
        submitting={submitting}
        error={formError}
        forbidden={forbidden}
        onFilenameChange={setFilename}
        onTextChange={setText}
        onSubmit={onUpload}
      />

      <div className="mt-6 bg-white border border-ink/15 rounded-lg overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-ink/15">
          <h2 className="text-sm font-medium text-ink/70">Library</h2>
          <span className="text-xs text-ink/40">{total} total</span>
        </div>

        {loading ? (
          <div className="px-5 py-10 text-center text-sm text-ink/40">
            Loading documents...
          </div>
        ) : error ? (
          <div className="px-5 py-10 text-center">
            <p className="text-sm text-red-600">{error}</p>
            <button
              onClick={() => load(page)}
              className="mt-2 text-sm text-accent"
            >
              Retry
            </button>
          </div>
        ) : docs.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-ink/40">
            No documents yet. Upload one above to get started.
          </div>
        ) : (
          <DocumentsTable docs={docs} />
        )}

        {!loading && !error && total > PAGE_LIMIT ? (
          <DocumentsPagination
            page={page}
            totalPages={totalPages}
            onPrev={() => setPage((p) => Math.max(1, p - 1))}
            onNext={() => setPage((p) => Math.min(totalPages, p + 1))}
          />
        ) : null}
      </div>
    </div>
  );
}
