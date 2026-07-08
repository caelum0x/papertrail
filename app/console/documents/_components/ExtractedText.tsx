import type { DocumentDetail, DocumentPage } from "@/lib/documents/types";

// Renders a document's extracted text: per-page when page data is available,
// otherwise the flat extracted_text blob, with failed/empty fallbacks.

interface ExtractedTextProps {
  doc: DocumentDetail;
  pages: DocumentPage[];
}

export function ExtractedText({ doc, pages }: ExtractedTextProps) {
  return (
    <div className="mt-6 bg-white border border-ink/15 rounded-lg overflow-hidden">
      <div className="px-5 py-3 border-b border-ink/15">
        <h2 className="text-sm font-medium text-ink/70">Extracted text</h2>
      </div>
      {doc.status === "failed" ? (
        <div className="px-5 py-8 text-center text-sm text-ink/40">
          Text extraction failed for this document.
        </div>
      ) : !doc.extracted_text ? (
        <div className="px-5 py-8 text-center text-sm text-ink/40">
          No extracted text yet.
        </div>
      ) : pages.length > 0 ? (
        <div className="divide-y divide-ink/10">
          {pages.map((pg) => (
            <div key={pg.page_number} className="px-5 py-4">
              <div className="text-xs text-ink/35 mb-2">Page {pg.page_number}</div>
              <pre className="whitespace-pre-wrap break-words font-mono text-sm text-ink/80">
                {pg.text}
              </pre>
            </div>
          ))}
        </div>
      ) : (
        <div className="px-5 py-4">
          <pre className="whitespace-pre-wrap break-words font-mono text-sm text-ink/80">
            {doc.extracted_text}
          </pre>
        </div>
      )}
    </div>
  );
}
