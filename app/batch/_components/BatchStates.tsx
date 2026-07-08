interface BatchLoadingProps {
  count: number;
}

export function BatchLoading({ count }: BatchLoadingProps) {
  return (
    <div className="mt-6 max-w-2xl rounded-lg border border-ink/10 bg-white p-4 text-sm text-ink/60">
      Verifying up to {count} claim
      {count === 1 ? "" : "s"} sequentially against their
      primary sources. This can take a moment per claim.
    </div>
  );
}

interface BatchErrorProps {
  message: string;
}

export function BatchError({ message }: BatchErrorProps) {
  return (
    <div className="mt-6 max-w-2xl rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800">
      {message}
    </div>
  );
}

interface TruncatedNoticeProps {
  totalDetected: number;
  maxBatch: number;
}

export function TruncatedNotice({ totalDetected, maxBatch }: TruncatedNoticeProps) {
  return (
    <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
      Detected {totalDetected} claims but only the first {maxBatch} were checked to
      keep this run fast and inexpensive. Split the remaining text into another batch
      to verify the rest.
    </div>
  );
}

export function BatchEmpty() {
  return (
    <div className="rounded-lg border border-ink/10 bg-white p-4 text-sm text-ink/60">
      No verifiable claims were returned for this passage.
    </div>
  );
}
