"use client";

import { useCallback, useRef, useState } from "react";
import { apiFetch } from "@/components/documents/api";
import type { DocumentSummary } from "@/lib/documents/types";
import type { PipelineSummary } from "@/lib/ingestion/pipeline";
import { DocumentBreadcrumb } from "../_components/DocumentBreadcrumb";
import { ImportControls } from "../_components/ImportControls";
import { ImportTable } from "../_components/ImportTable";
import {
  type ImportItem,
  fileToBase64,
} from "../_components/importTypes";

// Bulk import: select many PDFs, upload each, then run the extraction pipeline
// over it. Files are processed sequentially so a large batch doesn't overwhelm
// the API or blow the token budget all at once; each row shows its own status.

export default function BulkImportPage() {
  const [items, setItems] = useState<ImportItem[]>([]);
  const [running, setRunning] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const onSelectFiles = useCallback((files: FileList | null) => {
    if (!files) return;
    const next: ImportItem[] = Array.from(files).map((file) => ({
      file,
      status: "queued",
      documentId: null,
      pages: null,
      chunks: null,
      error: null,
    }));
    setItems((prev) => [...prev, ...next]);
  }, []);

  const patchItem = useCallback((index: number, patch: Partial<ImportItem>) => {
    setItems((prev) =>
      prev.map((it, i) => (i === index ? { ...it, ...patch } : it))
    );
  }, []);

  const runImport = useCallback(async () => {
    setRunning(true);
    setForbidden(false);

    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      if (item.status === "done") continue;

      patchItem(i, { status: "uploading", error: null });

      let contentBase64: string;
      try {
        contentBase64 = await fileToBase64(item.file);
      } catch {
        patchItem(i, { status: "error", error: "Could not read file." });
        continue;
      }

      const uploadRes = await apiFetch<DocumentSummary>(
        "/api/documents/upload",
        {
          method: "POST",
          body: JSON.stringify({
            filename: item.file.name,
            mime_type: item.file.type || "application/pdf",
            content_base64: contentBase64,
          }),
        }
      );

      if (!uploadRes.ok || !uploadRes.data) {
        if (uploadRes.status === 403) setForbidden(true);
        patchItem(i, {
          status: "error",
          error: uploadRes.error ?? "Upload failed.",
        });
        continue;
      }

      const documentId = uploadRes.data.id;
      patchItem(i, { status: "extracting", documentId });

      const extractRes = await apiFetch<PipelineSummary>(
        `/api/documents/${documentId}/extract`,
        { method: "POST" }
      );

      if (!extractRes.ok || !extractRes.data) {
        if (extractRes.status === 403) setForbidden(true);
        patchItem(i, {
          status: "error",
          error: extractRes.error ?? "Extraction failed.",
        });
        continue;
      }

      patchItem(i, {
        status: "done",
        pages: extractRes.data.page_count,
        chunks: extractRes.data.chunk_count,
      });
    }

    setRunning(false);
  }, [items, patchItem]);

  const clearAll = useCallback(() => {
    setItems([]);
    if (inputRef.current) inputRef.current.value = "";
  }, []);

  const doneCount = items.filter((it) => it.status === "done").length;

  return (
    <div>
      <DocumentBreadcrumb leaf="Bulk import" />

      <h1 className="mt-2 text-2xl font-semibold text-ink/80">
        Bulk import documents
      </h1>
      <p className="mt-1 text-sm text-ink/40">
        Select many PDFs at once. Each is uploaded and run through the extraction
        pipeline (pages + retrieval chunks) sequentially.
      </p>

      <ImportControls
        inputRef={inputRef}
        running={running}
        forbidden={forbidden}
        itemCount={items.length}
        doneCount={doneCount}
        onSelectFiles={onSelectFiles}
        onRun={runImport}
        onClear={clearAll}
      />

      <ImportTable items={items} />
    </div>
  );
}
