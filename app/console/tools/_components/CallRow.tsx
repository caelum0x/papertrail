import type { ToolCall } from "./types";

interface CallRowProps {
  call: ToolCall;
  isOpen: boolean;
  onToggle: (id: string) => void;
}

// One tool-call entry in the history list: a header button (tool name, status,
// time, duration) that expands to show pretty-printed input and output.
export function CallRow({ call, isOpen, onToggle }: CallRowProps) {
  return (
    <li className="px-5 py-3">
      <button
        onClick={() => onToggle(call.id)}
        className="w-full flex items-center justify-between gap-4 text-left"
      >
        <div className="min-w-0">
          <div className="text-sm text-ink/80 font-mono truncate">
            {call.toolName}
            <span
              className={`ml-2 text-xs ${
                call.status === "success" ? "text-ink/40" : "text-red-600"
              }`}
            >
              {call.status}
            </span>
          </div>
          <div className="text-xs text-ink/40">
            {new Date(call.createdAt).toLocaleString()} · {call.durationMs}ms
          </div>
        </div>
        <span className="text-xs text-ink/40 shrink-0">
          {isOpen ? "Hide" : "Details"}
        </span>
      </button>
      {isOpen ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <div className="text-xs text-ink/40 mb-1">Input</div>
            <pre className="bg-paper border border-ink/10 rounded p-3 text-xs text-ink/80 overflow-x-auto max-h-60">
              {JSON.stringify(call.input, null, 2)}
            </pre>
          </div>
          <div>
            <div className="text-xs text-ink/40 mb-1">Output</div>
            <pre className="bg-paper border border-ink/10 rounded p-3 text-xs text-ink/80 overflow-x-auto max-h-60">
              {JSON.stringify(call.output, null, 2)}
            </pre>
          </div>
        </div>
      ) : null}
    </li>
  );
}
