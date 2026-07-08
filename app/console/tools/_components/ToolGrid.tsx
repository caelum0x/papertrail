import type { Tool } from "./types";
import { ToolCard } from "./ToolCard";

interface ToolGridProps {
  tools: Tool[];
  loading: boolean;
  error: string | null;
  canRun: boolean;
  onTry: (tool: Tool) => void;
}

// The tool catalog: loading / error / empty states, otherwise a responsive grid
// of ToolCards.
export function ToolGrid({ tools, loading, error, canRun, onTry }: ToolGridProps) {
  if (loading) {
    return (
      <div className="bg-white border border-ink/10 rounded-lg p-5 text-sm text-ink/40">
        Loading tools...
      </div>
    );
  }
  if (error) {
    return (
      <div className="bg-white border border-ink/10 rounded-lg p-5 text-sm text-red-600">
        {error}
      </div>
    );
  }
  if (tools.length === 0) {
    return (
      <div className="bg-white border border-ink/10 rounded-lg p-5 text-sm text-ink/40">
        No tools are available.
      </div>
    );
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {tools.map((tool) => (
        <ToolCard key={tool.name} tool={tool} canRun={canRun} onTry={onTry} />
      ))}
    </div>
  );
}
