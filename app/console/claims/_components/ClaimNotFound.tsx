import Link from "next/link";

// Fallback shown when a claim fails to load or does not exist.

export function ClaimNotFound({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="max-w-2xl">
      <Link href="/console/claims" className="text-sm text-accent hover:underline">
        &larr; Back to claims
      </Link>
      <div className="mt-6 rounded-lg border border-ink/15 bg-white p-8 text-center">
        <p className="text-sm text-red-700">{message}</p>
        <button
          onClick={onRetry}
          className="mt-3 text-sm font-medium text-accent hover:underline"
        >
          Retry
        </button>
      </div>
    </div>
  );
}
