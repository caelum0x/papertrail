import type { Tool } from "./types";

interface ToolCardProps {
  tool: Tool;
  canRun: boolean;
  onTry: (tool: Tool) => void;
}

// A single tool in the catalog grid: name, source badge, description, and a
// "Try it" action gated on role + tool source.
export function ToolCard({ tool, canRun, onTry }: ToolCardProps) {
  return (
    <div className="bg-white border border-ink/10 rounded-lg p-5 flex flex-col">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-medium text-ink/80 font-mono">
          {tool.name}
        </div>
        <span className="text-xs text-ink/40 border border-ink/10 rounded px-2 py-0.5">
          {tool.source}
        </span>
      </div>
      <p className="mt-2 text-xs text-ink/60 flex-1">{tool.description}</p>
      <div className="mt-3 flex items-center gap-3">
        <button
          onClick={() => onTry(tool)}
          disabled={!canRun || tool.source === "registered"}
          className="text-xs border border-ink/15 rounded px-3 py-1.5 hover:border-accent disabled:opacity-40 disabled:cursor-not-allowed"
          title={
            !canRun
              ? "Requires editor role or higher"
              : tool.source === "registered"
              ? "Registered tools are declarations only"
              : undefined
          }
        >
          Try it
        </button>
        {!tool.enabled ? (
          <span className="text-xs text-red-600">disabled</span>
        ) : null}
      </div>
    </div>
  );
}
