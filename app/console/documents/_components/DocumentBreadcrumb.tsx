import Link from "next/link";

// Breadcrumb for document sub-pages: Documents / <filename> / <leaf>. If a
// document id + filename are supplied, the filename links to the detail page.

interface DocumentBreadcrumbProps {
  leaf: string;
  documentId?: string;
  filename?: string;
}

export function DocumentBreadcrumb({
  leaf,
  documentId,
  filename,
}: DocumentBreadcrumbProps) {
  return (
    <div className="flex items-center gap-2 text-sm text-ink/40">
      <Link href="/console/documents" className="hover:text-accent">
        Documents
      </Link>
      {documentId && filename ? (
        <>
          <span>/</span>
          <Link
            href={`/console/documents/${documentId}`}
            className="hover:text-accent break-all"
          >
            {filename}
          </Link>
        </>
      ) : null}
      <span>/</span>
      <span className="text-ink/60">{leaf}</span>
    </div>
  );
}
