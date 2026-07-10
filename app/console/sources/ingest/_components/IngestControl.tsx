"use client";

import { useCallback, useState } from "react";
import { SOURCE_OPTIONS } from "./types";

// Control panel for launching a multi-source ingest. The user provides a free-text query
// and/or an entity surface, optionally narrows the database set, and runs the ingest. The
// page owns loading/error/result state; this component only collects input and calls back.

export interface IngestFormValue {
  query: string;
  entitySurface: string;
  entityType: string;
  sources: string[];
  limit: number;
}

interface IngestControlProps {
  loading: boolean;
  onRun: (value: IngestFormValue) => void;
}

const ENTITY_TYPES: readonly string[] = ["", "gene", "disease", "drug", "cell_type", "tissue"];

const EXAMPLE_QUERIES: readonly string[] = [
  "JAK2 V617F thrombosis",
  "SGLT2 inhibitor heart failure",
];

export function IngestControl({ loading, onRun }: IngestControlProps) {
  const [query, setQuery] = useState("");
  const [entitySurface, setEntitySurface] = useState("");
  const [entityType, setEntityType] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [limit, setLimit] = useState(5);

  const toggleSource = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const submit = useCallback(() => {
    if (loading) return;
    onRun({
      query: query.trim(),
      entitySurface: entitySurface.trim(),
      entityType: entityType.trim(),
      sources: Array.from(selected),
      limit,
    });
  }, [loading, onRun, query, entitySurface, entityType, selected, limit]);

  const canRun = query.trim().length >= 3 || entitySurface.trim().length >= 1;

  return (
    <div className="rounded-lg border border-ink/15 bg-white p-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="space-y-4"
      >
        <div>
          <label className="block text-sm font-medium text-ink/70" htmlFor="ingest-query">
            Query
          </label>
          <input
            id="ingest-query"
            value={query}
            maxLength={500}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g. JAK2 V617F carriers thrombosis risk"
            className="mt-1 w-full rounded-md border border-ink/15 bg-white px-3 py-2 text-sm text-ink placeholder:text-ink/40 focus:border-accent focus:outline-none"
          />
          <div className="mt-2 flex flex-wrap gap-2">
            {EXAMPLE_QUERIES.map((ex) => (
              <button
                key={ex}
                type="button"
                onClick={() => setQuery(ex)}
                className="rounded-md border border-ink/15 bg-paper px-2.5 py-1 text-xs text-ink/60 hover:text-ink"
              >
                {ex}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label
              className="block text-sm font-medium text-ink/70"
              htmlFor="ingest-entity-surface"
            >
              Entity surface <span className="font-normal text-ink/40">(optional)</span>
            </label>
            <input
              id="ingest-entity-surface"
              value={entitySurface}
              maxLength={200}
              onChange={(e) => setEntitySurface(e.target.value)}
              placeholder="e.g. JAK2"
              className="mt-1 w-full rounded-md border border-ink/15 bg-white px-3 py-2 text-sm text-ink placeholder:text-ink/40 focus:border-accent focus:outline-none"
            />
          </div>
          <div>
            <label
              className="block text-sm font-medium text-ink/70"
              htmlFor="ingest-entity-type"
            >
              Entity type
            </label>
            <select
              id="ingest-entity-type"
              value={entityType}
              onChange={(e) => setEntityType(e.target.value)}
              className="mt-1 w-full rounded-md border border-ink/15 bg-white px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none"
            >
              {ENTITY_TYPES.map((t) => (
                <option key={t || "any"} value={t}>
                  {t === "" ? "Any" : t}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <span className="block text-sm font-medium text-ink/70">Databases</span>
          <p className="mt-0.5 text-xs text-ink/40">
            Leave all unselected to let the pipeline use its default set.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {SOURCE_OPTIONS.map((opt) => {
              const active = selected.has(opt.id);
              return (
                <button
                  key={opt.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggleSource(opt.id)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                    active
                      ? "border-accent bg-accent text-white"
                      : "border-ink/15 bg-paper text-ink/60 hover:text-ink"
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <label className="block text-sm font-medium text-ink/70" htmlFor="ingest-limit">
              Per-source limit
            </label>
            <input
              id="ingest-limit"
              type="number"
              min={1}
              max={20}
              value={limit}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isFinite(n)) setLimit(Math.min(20, Math.max(1, Math.floor(n))));
              }}
              className="mt-1 w-24 rounded-md border border-ink/15 bg-white px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={loading || !canRun}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40"
          >
            {loading ? "Ingesting…" : "Run ingest"}
          </button>
        </div>
      </form>
    </div>
  );
}
