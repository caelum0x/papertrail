import Link from "next/link";

// Page header for the team overview: title, description, and a link to the
// roles & permissions reference.
export function TeamHeader() {
  return (
    <div className="flex items-center justify-between">
      <div>
        <h1 className="text-2xl font-semibold text-ink/80">Team</h1>
        <p className="mt-1 text-sm text-ink/40">
          Members of this organization and their roles.
        </p>
      </div>
      <Link
        href="/console/settings/roles"
        className="text-sm text-accent hover:underline"
      >
        Roles &amp; permissions
      </Link>
    </div>
  );
}
