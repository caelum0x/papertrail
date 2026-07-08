import type { SrRecord } from "@/app/api/sr-projects/lib/types";

// One screenable record: title, abstract, exclusion-reason input, and the
// include/exclude actions. All state and handlers come from the parent queue.

interface RecordCardProps {
  record: SrRecord;
  reason: string;
  onReasonChange: (value: string) => void;
  onScreen: (decision: "include" | "exclude") => void;
  acting: boolean;
}

export function RecordCard({
  record,
  reason,
  onReasonChange,
  onScreen,
  acting,
}: RecordCardProps) {
  return (
    <div className="rounded-lg border border-ink/15 bg-white p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-ink/80">{record.title}</h3>
          <p className="mt-0.5 text-xs uppercase tracking-wide text-ink/40">
            {record.sourceType}
            {record.externalId ? ` · ${record.externalId}` : ""}
          </p>
        </div>
      </div>
      {record.abstract ? (
        <p className="mt-2 whitespace-pre-wrap text-sm text-ink/60">
          {record.abstract}
        </p>
      ) : (
        <p className="mt-2 text-sm text-ink/40">No abstract provided.</p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          value={reason}
          onChange={(e) => onReasonChange(e.target.value)}
          placeholder="Exclusion reason (required to exclude)"
          className="min-w-0 flex-1 rounded-md border border-ink/15 bg-white px-3 py-1.5 text-sm text-ink/80 focus:border-accent focus:outline-none"
        />
        <button
          onClick={() => onScreen("include")}
          disabled={acting}
          className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          Include
        </button>
        <button
          onClick={() => onScreen("exclude")}
          disabled={acting}
          className="rounded-md border border-red-600/40 px-4 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
        >
          Exclude
        </button>
      </div>
    </div>
  );
}
