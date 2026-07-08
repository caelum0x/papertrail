import type { ExtractionJob } from "@/lib/ingestion/pipeline";

// Extraction status summary + action buttons (run extraction, extract claims)
// for the pipeline page.

const JOB_STYLE: Record<string, string> = {
  pending: "text-ink/50",
  processing: "text-ink/60",
  completed: "text-accent",
  failed: "text-red-600",
};

const JOB_LABEL: Record<string, string> = {
  pending: "Pending",
  processing: "Processing",
  completed: "Completed",
  failed: "Failed",
};

interface ExtractionStatusProps {
  job: ExtractionJob | null;
  extracting: boolean;
  extractingClaims: boolean;
  actionError: string | null;
  onRunExtraction: () => void;
  onExtractClaims: () => void;
}

export function ExtractionStatus({
  job,
  extracting,
  extractingClaims,
  actionError,
  onRunExtraction,
  onExtractClaims,
}: ExtractionStatusProps) {
  const jobStatus = job?.status ?? "pending";
  return (
    <div className="mt-6 bg-white border border-ink/15 rounded-lg p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs text-ink/40">Extraction status</div>
          <div
            className={`mt-1 text-lg font-semibold ${
              JOB_STYLE[jobStatus] ?? "text-ink/70"
            }`}
          >
            {JOB_LABEL[jobStatus] ?? jobStatus}
          </div>
          {job ? (
            <div className="mt-1 text-xs text-ink/40">
              {job.engine ? `Engine: ${job.engine} · ` : ""}
              {job.pages} page{job.pages === 1 ? "" : "s"}
              {job.error ? (
                <span className="block text-red-600">{job.error}</span>
              ) : null}
            </div>
          ) : (
            <div className="mt-1 text-xs text-ink/40">No extraction run yet.</div>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={onRunExtraction}
            disabled={extracting}
            className="rounded bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {extracting ? "Extracting..." : "Run extraction"}
          </button>
          <button
            onClick={onExtractClaims}
            disabled={extractingClaims}
            className="rounded border border-accent/40 px-4 py-2 text-sm font-medium text-accent disabled:opacity-50"
          >
            {extractingClaims ? "Extracting..." : "Extract claims"}
          </button>
        </div>
      </div>
      {actionError ? (
        <p className="mt-3 text-sm text-red-600">{actionError}</p>
      ) : null}
    </div>
  );
}
