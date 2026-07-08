"use client";

import { useCallback, useState } from "react";
import { sendJson } from "@/components/admin-audit/apiClient";
import { fieldEntries, type CallResult, type Tool } from "./types";
import { TryItField } from "./TryItField";

interface TryItPanelProps {
  tool: Tool;
  canRun: boolean;
  onClose: () => void;
}

// Modal that renders a form from a tool's JSON-schema and executes it against
// POST /api/tools/[name]/call, showing the result or an error inline. Owns its
// own form/run state so the tools page just decides when to mount it.
export function TryItPanel({ tool, canRun, onClose }: TryItPanelProps) {
  const [form, setForm] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [result, setResult] = useState<CallResult | null>(null);

  const onRun = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setRunning(true);
      setRunError(null);
      setResult(null);

      // Coerce number-typed fields; forward only non-empty values.
      const payload: Record<string, unknown> = {};
      for (const [key, prop] of fieldEntries(tool.inputSchema)) {
        const raw = form[key]?.trim();
        if (!raw) continue;
        if (prop.type === "number") {
          const n = Number(raw);
          if (!Number.isNaN(n)) payload[key] = n;
        } else {
          payload[key] = raw;
        }
      }

      const res = await sendJson<CallResult>(
        `/api/tools/${encodeURIComponent(tool.name)}/call`,
        "POST",
        payload
      );
      setRunning(false);
      if (!res.success || !res.data) {
        setRunError(res.error ?? "Tool execution failed.");
        return;
      }
      setResult(res.data);
    },
    [tool, form]
  );

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-ink/30 p-4">
      <form
        onSubmit={onRun}
        className="w-full max-w-lg bg-white border border-ink/15 rounded-lg p-5 max-h-[90vh] overflow-y-auto"
      >
        <h3 className="text-sm font-medium text-ink/80 font-mono">{tool.name}</h3>
        <p className="mt-1 text-xs text-ink/40">{tool.description}</p>

        {fieldEntries(tool.inputSchema).map(([key, prop]) => (
          <TryItField
            key={key}
            name={key}
            prop={prop}
            required={tool.inputSchema.required?.includes(key) ?? false}
            value={form[key] ?? ""}
            onChange={(value) => setForm((prev) => ({ ...prev, [key]: value }))}
          />
        ))}

        {runError ? <p className="mt-3 text-sm text-red-600">{runError}</p> : null}

        {result ? (
          <div className="mt-4">
            <div className="text-xs text-ink/40">
              Completed in {result.durationMs}ms
            </div>
            <pre className="mt-1 bg-paper border border-ink/10 rounded p-3 text-xs text-ink/80 overflow-x-auto max-h-72">
              {JSON.stringify(result.output, null, 2)}
            </pre>
          </div>
        ) : null}

        <div className="mt-5 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-ink/60 hover:text-ink/80"
          >
            Close
          </button>
          <button
            type="submit"
            disabled={running || !canRun}
            className="text-sm bg-accent text-white rounded px-4 py-2 disabled:opacity-50"
          >
            {running ? "Running..." : "Run tool"}
          </button>
        </div>
      </form>
    </div>
  );
}
