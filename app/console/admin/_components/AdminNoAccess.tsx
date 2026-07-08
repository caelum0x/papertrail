interface AdminNoAccessProps {
  title: string;
  message?: string;
}

// Shown when a non-admin visits an admin-scoped page.
export function AdminNoAccess({
  title,
  message = "You need an admin or owner role to view the admin console.",
}: AdminNoAccessProps) {
  return (
    <div>
      <h1 className="text-2xl font-semibold text-ink/80">{title}</h1>
      <p className="mt-4 text-sm text-ink/60">{message}</p>
    </div>
  );
}
