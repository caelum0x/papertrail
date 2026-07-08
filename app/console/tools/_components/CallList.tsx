import { useState } from "react";
import Link from "next/link";
import type { ToolCall } from "./types";
import { CallRow } from "./CallRow";

interface CallListProps {
  calls: ToolCall[];
  loading: boolean;
  error: string | null;
}

// The tool-call history card: loading / error / empty states, otherwise a list
// of expandable CallRows. Owns the single-open-row expand state locally.
export function CallList({ calls, loading, error }: CallListProps) {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className="mt-6 bg-white border border-ink/10 rounded-lg overflow-hidden">
      {loading ? (
        <div className="p-5 text-sm text-ink/40">Loading history...</div>
      ) : error ? (
        <div className="p-5 text-sm text-red-600">{error}</div>
      ) : calls.length === 0 ? (
        <div className="p-5 text-sm text-ink/40">
          No tools have been called yet. Run one from the{" "}
          <Link href="/console/tools" className="text-accent hover:underline">
            tool catalog
          </Link>
          .
        </div>
      ) : (
        <ul className="divide-y divide-ink/10">
          {calls.map((call) => (
            <CallRow
              key={call.id}
              call={call}
              isOpen={expanded === call.id}
              onToggle={(id) => setExpanded((cur) => (cur === id ? null : id))}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
