"use client";

import { useCallback, useState } from "react";
import type { ApiResponse } from "@/lib/api/response";
import { ModuleHeader } from "../claims/_components/ModuleHeader";
import { GraphCanvas } from "./_components/GraphCanvas";
import { EdgeDetail } from "./_components/EdgeDetail";
import { Legend } from "./_components/Legend";
import type { GraphApiData, GraphEdge } from "./_components/types";

// Evidence Knowledge Graph console. Paste an abstract / passage (or a list of cached
// source ids), and Claude extracts biomedical entities + typed relations from the
// text. Every relation is grounded to an exact source sentence server-side; the graph
// below shows only grounded edges. Click any edge to read the sentence that backs it.

const SEED_TEXT =
  "In the PARADIGM-HF trial, sacubitril/valsartan reduced the risk of cardiovascular death or hospitalization for heart failure compared with enalapril in patients with chronic heart failure and reduced ejection fraction (hazard ratio 0.80; 95% CI 0.73-0.87). Treatment with sacubitril/valsartan was associated with hypotension. There was no significant effect on the rate of renal impairment.";

export default function KnowledgeGraphPage() {
  const [text, setText] = useState(SEED_TEXT);
  const [sourceIds, setSourceIds] = useState("");
  const [data, setData] = useState<GraphApiData | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<GraphEdge | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    // Build the request from whichever input the user filled. Source ids take the
    // ad-hoc text's place when provided; both may be sent together.
    const ids = sourceIds
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    const body: { text?: string; source_ids?: string[] } = {};
    if (ids.length > 0) body.source_ids = ids;
    if (text.trim().length >= 40) body.text = text.trim();

    if (!body.text && !body.source_ids) {
      setError("Paste a passage of at least 40 characters, or enter one or more cached source ids.");
      return;
    }

    setLoading(true);
    setError(null);
    setSelectedEdge(null);
    try {
      const res = await fetch("/api/graph", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const parsed = (await res.json().catch(() => null)) as ApiResponse<GraphApiData> | null;
      if (!parsed) throw new Error("Unexpected server response.");
      if (!res.ok || !parsed.success || !parsed.data) {
        throw new Error(parsed.error ?? "Graph extraction failed.");
      }
      setData(parsed.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to build the graph.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [text, sourceIds]);

  return (
    <div className="space-y-6">
      <ModuleHeader
        title="Evidence knowledge graph"
        subtitle="Claude extracts biomedical entities and typed relations from source text; every edge is grounded to an exact source sentence."
      />

      <div className="rounded-lg border border-ink/15 bg-white p-4">
        <label className="block text-sm font-medium text-ink/70" htmlFor="graph-text">
          Source text
        </label>
        <textarea
          id="graph-text"
          rows={5}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Paste an abstract or trial summary here…"
          className="mt-1 w-full rounded-md border border-ink/15 bg-white px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none"
        />

        <label className="mt-3 block text-sm font-medium text-ink/70" htmlFor="graph-ids">
          Cached source ids <span className="font-normal text-ink/40">(optional — comma/space separated)</span>
        </label>
        <input
          id="graph-ids"
          value={sourceIds}
          onChange={(e) => setSourceIds(e.target.value)}
          placeholder="e.g. 11111111-1111-1111-1111-111111111111"
          className="mt-1 w-full rounded-md border border-ink/15 bg-white px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none"
        />

        <div className="mt-3 flex items-center gap-3">
          <button
            onClick={run}
            disabled={loading}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {loading ? "Extracting…" : "Build graph"}
          </button>
          {error ? (
            <p className="text-sm text-red-700" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      </div>

      {data ? (
        <div className="space-y-4">
          <Legend stats={data.graph.stats} />
          {data.failed_sources > 0 || data.missing_source_ids.length > 0 ? (
            <p className="text-xs text-ink/40">
              {data.failed_sources > 0 ? `${data.failed_sources} source(s) failed extraction. ` : ""}
              {data.missing_source_ids.length > 0
                ? `${data.missing_source_ids.length} requested id(s) not in cache.`
                : ""}
            </p>
          ) : null}

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <GraphCanvas
                graph={data.graph}
                selectedEdgeId={selectedEdge?.id ?? null}
                onSelectEdge={setSelectedEdge}
              />
            </div>
            <div className="lg:col-span-1">
              <EdgeDetail graph={data.graph} edge={selectedEdge} />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
