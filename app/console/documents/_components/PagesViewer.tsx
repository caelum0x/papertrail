import type { DocumentPage } from "@/lib/documents/types";

// Per-page text viewer used on the pipeline page.

export function PagesViewer({ pages }: { pages: DocumentPage[] }) {
  return (
    <div className="mt-6 bg-white border border-ink/15 rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-ink/15">
        <h2 className="text-sm font-medium text-ink/70">Pages</h2>
        <span className="text-xs text-ink/40">
          {pages.length} page{pages.length === 1 ? "" : "s"}
        </span>
      </div>
      {pages.length === 0 ? (
        <div className="px-5 py-8 text-center text-sm text-ink/40">
          No pages yet. Run extraction to populate the page-by-page view.
        </div>
      ) : (
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
      )}
    </div>
  );
}
