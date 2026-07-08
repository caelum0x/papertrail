"use client";

import { BatchResultItem } from "@/components/BatchResults";
import { toBatchMarkdownReport } from "@/lib/batchReport";

function downloadFile(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Client-side combined provenance report download for a whole batch run — no server
 * round-trip, no LLM cost. Builds one Markdown citation trail from the already-rendered
 * results, including honest notes for claims with no confident source.
 */
export function DownloadBatchReport({ items }: { items: BatchResultItem[] }) {
  return (
    <button
      onClick={() =>
        downloadFile(
          "papertrail-batch-report.md",
          toBatchMarkdownReport(items),
          "text/markdown"
        )
      }
      className="rounded-md border border-ink/15 bg-white px-3 py-1.5 text-sm text-ink/70 hover:bg-ink/5"
    >
      Download batch report (.md)
    </button>
  );
}
