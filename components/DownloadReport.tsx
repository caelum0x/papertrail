"use client";

import { ReportInput, toMarkdownReport } from "@/lib/reportExport";
import { toHtmlReport } from "@/lib/reportExportHtml";

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
 * Client-side provenance report download — no server round-trip, no LLM cost.
 * Builds the Markdown / printable-HTML report from the already-rendered result.
 */
export function DownloadReport({ input }: { input: ReportInput }) {
  return (
    <div className="flex flex-wrap gap-2">
      <button
        onClick={() => downloadFile("papertrail-report.md", toMarkdownReport(input), "text/markdown")}
        className="rounded-md border border-ink/15 bg-white px-3 py-1.5 text-sm text-ink/70 hover:bg-ink/5"
      >
        Download report (.md)
      </button>
      <button
        onClick={() => downloadFile("papertrail-report.html", toHtmlReport(input), "text/html")}
        className="rounded-md border border-ink/15 bg-white px-3 py-1.5 text-sm text-ink/70 hover:bg-ink/5"
      >
        Printable (.html)
      </button>
    </div>
  );
}
