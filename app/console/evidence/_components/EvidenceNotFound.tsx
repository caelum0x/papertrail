import Link from "next/link";

// Fallback shown when an evidence item fails to load or does not exist.

export function EvidenceNotFound({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div>
      <Link
        href="/console/evidence"
        className="text-sm text-accent hover:underline"
      >
        ← Back to library
      </Link>
      <div className="mt-4 bg-white border border-red-200 rounded-lg p-6 text-center">
        <p className="text-sm text-red-600">{message}</p>
        <button
          onClick={onRetry}
          className="mt-3 text-sm text-accent hover:underline"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
