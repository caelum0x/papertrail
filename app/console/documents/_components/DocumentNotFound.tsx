import Link from "next/link";

// Fallback shown when a document fails to load or does not exist.

export function DocumentNotFound({ message }: { message: string }) {
  return (
    <div>
      <Link href="/console/documents" className="text-sm text-accent">
        ← Back to documents
      </Link>
      <p className="mt-4 text-sm text-red-600">{message}</p>
    </div>
  );
}
