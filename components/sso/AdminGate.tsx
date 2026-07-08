"use client";

import { useCurrentRole } from "@/components/org-team/useCurrentRole";

// Client-side admin gate for the SSO settings surfaces. Mirrors the server-side
// requireRole("admin") in the API so non-admins get a clear message instead of a
// broken page. UX-only — the API is the real enforcement point.

export function AdminGate({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const { canManage, loading } = useCurrentRole();

  if (loading) {
    return <p className="text-sm text-ink/40">Loading…</p>;
  }
  if (!canManage) {
    return (
      <div>
        <h1 className="text-2xl font-semibold text-ink/80">{title}</h1>
        <p className="mt-4 text-sm text-ink/60">
          You need an admin or owner role to manage {title.toLowerCase()}.
        </p>
      </div>
    );
  }
  return <>{children}</>;
}
