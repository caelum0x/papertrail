import type { ToolTrace } from "@/lib/copilot/schemas";

// Transparent trace of the tools the copilot invoked for a turn, rendered as
// pills. Each pill shows the tool name and a one-line summary of what it returned
// (or the error), so a reviewer can see exactly how the answer was assembled —
// this is the visible proof the copilot reasons over real engine calls, not memory.

const TOOL_LABELS: Record<string, string> = {
  search_sources: "Search sources",
  verify_claim: "Verify claim",
  run_synthesis: "Run synthesis",
};

interface ToolTracePillsProps {
  trace: ToolTrace[];
}

export function ToolTracePills({ trace }: ToolTracePillsProps) {
  if (trace.length === 0) return null;

  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {trace.map((t, i) => {
        const label = TOOL_LABELS[t.tool] ?? t.tool;
        return (
          <span
            key={`${t.tool}-${i}`}
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${
              t.ok
                ? "border-accent/30 bg-accent/5 text-accent"
                : "border-red-300 bg-red-50 text-red-700"
            }`}
            title={t.error ?? `${t.durationMs}ms`}
          >
            <span className="font-medium">{label}</span>
            <span className="opacity-60">·</span>
            <span className="opacity-80">{t.ok ? t.summary : t.error ?? "failed"}</span>
          </span>
        );
      })}
    </div>
  );
}
