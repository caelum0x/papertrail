"use client";

import { ToolsHeader } from "../_components/ToolsHeader";
import { useTools } from "../_components/useTools";

// Tools overview sub-page: a read-only summary of the org's callable toolset —
// totals by source and enabled state, plus a compact reference list. Reuses the
// existing GET /api/tools via the shared useTools hook (no new APIs).
export default function ToolsOverviewPage() {
  const { tools, loading, error } = useTools();

  const total = tools.length;
  const builtin = tools.filter((t) => t.source === "builtin").length;
  const registered = tools.filter((t) => t.source === "registered").length;
  const enabled = tools.filter((t) => t.enabled).length;

  const stats: Array<{ label: string; value: number }> = [
    { label: "Total tools", value: total },
    { label: "Built-in", value: builtin },
    { label: "Registered", value: registered },
    { label: "Enabled", value: enabled },
  ];

  return (
    <div>
      <ToolsHeader
        title="Tools overview"
        subtitle="A summary of the callable capabilities available to this organization."
        action={{ href: "/console/tools", label: "Back to tools" }}
      />

      {loading ? (
        <p className="mt-6 text-sm text-ink/40">Loading overview...</p>
      ) : error ? (
        <p className="mt-6 text-sm text-red-600">{error}</p>
      ) : (
        <>
          <div className="mt-6 grid gap-4 grid-cols-2 sm:grid-cols-4">
            {stats.map((s) => (
              <div
                key={s.label}
                className="bg-white border border-ink/10 rounded-lg p-5"
              >
                <div className="text-2xl font-semibold text-ink/80 tabular-nums">
                  {s.value}
                </div>
                <div className="mt-1 text-xs text-ink/40">{s.label}</div>
              </div>
            ))}
          </div>

          <div className="mt-8 bg-white border border-ink/10 rounded-lg overflow-hidden">
            <div className="px-5 py-3 border-b border-ink/10 text-sm font-medium text-ink/70">
              Reference
            </div>
            {tools.length === 0 ? (
              <div className="p-5 text-sm text-ink/40">No tools available.</div>
            ) : (
              <ul className="divide-y divide-ink/10">
                {tools.map((t) => (
                  <li
                    key={t.name}
                    className="px-5 py-3 flex items-center justify-between gap-4"
                  >
                    <div className="min-w-0">
                      <div className="text-sm text-ink/80 font-mono truncate">
                        {t.name}
                        {!t.enabled ? (
                          <span className="ml-2 text-xs text-red-600">
                            disabled
                          </span>
                        ) : null}
                      </div>
                      <div className="text-xs text-ink/40 truncate">
                        {t.description}
                      </div>
                    </div>
                    <span className="text-xs text-ink/40 border border-ink/10 rounded px-2 py-0.5 shrink-0">
                      {t.source}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
