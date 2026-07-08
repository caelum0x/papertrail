import Link from "next/link";

// Page header for the audit log. Optionally renders a link to the summary
// sub-page.
export function AuditHeader() {
  return (
    <div className="flex items-start justify-between">
      <div>
        <h1 className="text-2xl font-semibold text-ink/80">Audit log</h1>
        <p className="mt-1 text-sm text-ink/40">
          A record of meaningful actions across your organization.
        </p>
      </div>
      <Link
        href="/console/audit/summary"
        className="text-sm text-accent hover:underline shrink-0"
      >
        Summary
      </Link>
    </div>
  );
}
