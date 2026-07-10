"use client";

import {
  useCallback,
  useId,
  useRef,
  useState,
  type DragEvent,
} from "react";
import { apiFetch } from "@/components/documents/api";
import type { DocumentSummary } from "@/lib/documents/types";
import { ErrorBanner } from "@/components/console/StateBanners";
import { fileToBase64 } from "./importTypes";

// Drag-and-drop multi-file uploader for the documents module. Reads each file as
// base64 and POSTs to /api/documents/upload (which extracts PDFs in-process and
// treats other content as UTF-8 text). Files are uploaded sequentially so a large
// batch doesn't overwhelm the API; each file gets its own status row.

const ACCEPT = ".pdf,.docx,.xlsx,.xls,.csv,.md,.txt";
const ACCEPT_LABEL = "PDF, DOCX, XLSX, XLS, CSV, MD, TXT";
const MAX_BYTES = 15 * 1024 * 1024; // 15 MB guardrail.

type RowStatus = "queued" | "uploading" | "done" | "error";

interface UploadRow {
  id: string;
  filename: string;
  sizeBytes: number;
  status: RowStatus;
  error: string | null;
}

const STATUS_LABEL: Record<RowStatus, string> = {
  queued: "Queued",
  uploading: "Uploading…",
  done: "Done",
  error: "Failed",
};

const STATUS_STYLE: Record<RowStatus, string> = {
  queued: "text-ink/40",
  uploading: "text-ink/60",
  done: "text-accent",
  error: "text-red-600",
};

// Best-effort extension → short badge. Falls back to a generic label.
function formatBadge(filename: string): string {
  const dot = filename.lastIndexOf(".");
  const ext = dot >= 0 ? filename.slice(dot + 1).toUpperCase() : "";
  return ext || "FILE";
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

let rowSeq = 0;
function nextRowId(): string {
  rowSeq += 1;
  return `row-${Date.now()}-${rowSeq}`;
}

export function Uploader() {
  const [rows, setRows] = useState<UploadRow[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();

  const patchRow = useCallback((id: string, patch: Partial<UploadRow>) => {
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, ...patch } : r))
    );
  }, []);

  // Uploads one file; returns true on success. Immutable row updates throughout.
  const uploadOne = useCallback(
    async (row: UploadRow, file: File): Promise<boolean> => {
      patchRow(row.id, { status: "uploading", error: null });

      let contentBase64: string;
      try {
        contentBase64 = await fileToBase64(file);
      } catch {
        patchRow(row.id, { status: "error", error: "Could not read file." });
        return false;
      }

      const res = await apiFetch<DocumentSummary>("/api/documents/upload", {
        method: "POST",
        body: JSON.stringify({
          filename: file.name,
          mime_type: file.type || "application/octet-stream",
          content_base64: contentBase64,
        }),
      });

      if (!res.ok || !res.data) {
        if (res.status === 403) {
          setError("You don't have permission to upload documents.");
        }
        patchRow(row.id, {
          status: "error",
          error: res.error ?? "Upload failed.",
        });
        return false;
      }

      patchRow(row.id, { status: "done", error: null });
      return true;
    },
    [patchRow]
  );

  // Validates the batch, then uploads accepted files sequentially.
  const handleFiles = useCallback(
    async (fileList: FileList | File[] | null) => {
      if (!fileList) return;
      const files = Array.from(fileList);
      if (files.length === 0) return;

      setError(null);

      const accepted: Array<{ row: UploadRow; file: File }> = [];
      const skipped: UploadRow[] = [];

      for (const file of files) {
        const id = nextRowId();
        const base: UploadRow = {
          id,
          filename: file.name,
          sizeBytes: file.size,
          status: "queued",
          error: null,
        };
        if (file.size > MAX_BYTES) {
          skipped.push({
            ...base,
            status: "error",
            error: `Too large (${formatSize(file.size)}). Max is 15 MB.`,
          });
        } else {
          accepted.push({ row: base, file });
        }
      }

      const newRows = [
        ...accepted.map((a) => a.row),
        ...skipped,
      ];
      setRows((prev) => [...prev, ...newRows]);

      if (accepted.length === 0) return;

      setRunning(true);
      for (const { row, file } of accepted) {
        await uploadOne(row, file);
      }
      setRunning(false);
    },
    [uploadOne]
  );

  const onDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragOver(false);
      if (running) return;
      void handleFiles(e.dataTransfer?.files ?? null);
    },
    [handleFiles, running]
  );

  const onDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const onDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
  }, []);

  const openPicker = useCallback(() => {
    if (!running) inputRef.current?.click();
  }, [running]);

  const clearAll = useCallback(() => {
    if (running) return;
    setRows([]);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  }, [running]);

  const doneCount = rows.filter((r) => r.status === "done").length;
  const errorCount = rows.filter((r) => r.status === "error").length;

  return (
    <div className="mt-6 grid gap-4">
      {error ? <ErrorBanner message={error} /> : null}

      {/* Drop zone. Clicking or pressing Enter/Space opens the file picker. */}
      <div
        role="button"
        tabIndex={0}
        aria-label="Upload files by dragging them here or activating to choose files"
        aria-disabled={running}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onClick={openPicker}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openPicker();
          }
        }}
        className={`rounded-lg border-2 border-dashed p-8 text-center transition-colors focus:outline-none focus:ring-2 focus:ring-accent ${
          dragOver
            ? "border-accent bg-accent/5"
            : "border-ink/15 bg-white hover:border-accent/50"
        } ${running ? "opacity-60" : "cursor-pointer"}`}
      >
        <p className="text-sm font-medium text-ink/70">
          Drag and drop files here
        </p>
        <p className="mt-1 text-xs text-ink/40">
          or{" "}
          <span className="text-accent underline">browse to choose files</span>
        </p>
        <p className="mt-3 text-xs text-ink/40">Supported: {ACCEPT_LABEL}</p>
        <p className="text-xs text-ink/40">Up to 15 MB per file.</p>

        <label htmlFor={inputId} className="sr-only">
          Choose files to upload
        </label>
        <input
          id={inputId}
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          multiple
          disabled={running}
          onChange={(e) => {
            void handleFiles(e.target.files);
            // Allow re-selecting the same file after clearing.
            if (e.target) e.target.value = "";
          }}
          className="sr-only"
        />
      </div>

      {rows.length > 0 ? (
        <div className="rounded-lg border border-ink/15 bg-white overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b border-ink/15">
            <h2 className="text-sm font-medium text-ink/70">Upload queue</h2>
            <button
              type="button"
              onClick={clearAll}
              disabled={running}
              className="text-xs text-ink/60 hover:text-accent disabled:opacity-40"
            >
              Clear
            </button>
          </div>

          <ul className="divide-y divide-ink/10" aria-live="polite">
            {rows.map((row) => (
              <li
                key={row.id}
                className="flex items-center gap-3 px-5 py-3"
              >
                <span className="inline-flex shrink-0 items-center rounded bg-ink/5 px-2 py-1 text-[10px] font-semibold tracking-wide text-ink/60">
                  {formatBadge(row.filename)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-ink/80">
                    {row.filename}
                  </p>
                  <p className="text-xs text-ink/40">
                    {formatSize(row.sizeBytes)}
                    {row.error ? ` — ${row.error}` : ""}
                  </p>
                </div>
                <span
                  className={`shrink-0 text-xs font-medium ${STATUS_STYLE[row.status]}`}
                >
                  {STATUS_LABEL[row.status]}
                </span>
              </li>
            ))}
          </ul>

          <div
            className="border-t border-ink/15 px-5 py-3 text-xs text-ink/50"
            role="status"
            aria-live="polite"
          >
            {running
              ? "Uploading files…"
              : `${doneCount} uploaded, ${errorCount} failed, ${rows.length} total.`}
          </div>
        </div>
      ) : null}
    </div>
  );
}
