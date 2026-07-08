import Link from "next/link";

// Fallback card shown when a project fails to load or does not exist.

export function NotFoundCard({ message }: { message: string }) {
  return (
    <div className="bg-white border border-ink/15 rounded-lg p-5">
      <p className="text-sm text-red-600">{message}</p>
      <Link
        href="/console/projects"
        className="mt-2 inline-block text-sm text-accent"
      >
        Back to projects
      </Link>
    </div>
  );
}
