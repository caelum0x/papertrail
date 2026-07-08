interface AuditNoAccessProps {
  title?: string;
}

// Shown when a non-admin visits an audit-scoped page.
export function AuditNoAccess({ title = "Audit log" }: AuditNoAccessProps) {
  return (
    <div>
      <h1 className="text-2xl font-semibold text-ink/80">{title}</h1>
      <p className="mt-4 text-sm text-ink/60">
        You need an admin or owner role to view the audit log.
      </p>
    </div>
  );
}
