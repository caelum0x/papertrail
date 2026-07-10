"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// Reusable control for picking cached sources (PubMed / ClinicalTrials.gov rows
// already in the `sources` table). Searches the cached-source list endpoint,
// shows results as a multi-select checklist, and reports the selected ids via
// onChange. This is how a reviewer feeds sources into auto-synthesis without
// hand-typing UUIDs.
//
// It reads the cached-source list endpoint (GET /api/sources?q=), which returns a
// plain { items, total } payload where each item carries a stable id plus the
// human-facing title, source_type and external_id (PMID / NCT). No LLM is
// involved — this is pure catalogue navigation over already-ingested rows.

// The wire shape of a single cached source row, mirroring lib/queries/sources.ts
// SourceListItem. Kept local so this component doesn't import server code.
export interface CachedSource {
  id: string;
  source_type: string;
  external_id: string;
  title: string | null;
  url: string;
}

interface SourcesListWire {
  items: CachedSource[];
  total: number;
}

export interface SourcePickerProps {
  // Called whenever the selection changes, with the current selected source ids.
  onChange: (selectedSourceIds: string[]) => void;
  // Optional initial selection (source ids). Applied once on mount.
  initialSelectedIds?: string[];
  // Optional cap on how many sources may be selected. Undefined = no cap.
  maxSelected?: number;
  // Optional label for the search input (defaults to a sensible one).
  label?: string;
}

const ORG_STORAGE_KEY = "pt_active_org";
const DEBOUNCE_MS = 250;
const PAGE_LIMIT = 25;

// The list endpoint is org-agnostic, but mirror the search helper and forward the
// active org id header when present so behaviour is consistent across the console.
function orgHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  if (typeof window !== "undefined") {
    const orgId = window.localStorage.getItem(ORG_STORAGE_KEY);
    if (orgId) {
      headers["x-org-id"] = orgId;
    }
  }
  return headers;
}

async function fetchSources(
  q: string,
  signal: AbortSignal
): Promise<CachedSource[]> {
  const params = new URLSearchParams();
  if (q) {
    params.set("q", q);
  }
  params.set("limit", String(PAGE_LIMIT));

  const res = await fetch(`/api/sources?${params.toString()}`, {
    headers: orgHeaders(),
    signal,
  });
  const body = (await res.json().catch(() => null)) as
    | (SourcesListWire & { error?: string })
    | { error: string }
    | null;
  if (!body) {
    throw new Error("Unexpected server response.");
  }
  if (!res.ok || !("items" in body)) {
    const message = body && "error" in body ? body.error : undefined;
    throw new Error(message ?? "Couldn't load cached sources.");
  }
  return body.items;
}

function displayTitle(source: CachedSource): string {
  const title = source.title?.trim();
  if (title && title.length > 0) {
    return title;
  }
  return `${source.source_type} ${source.external_id}`;
}

// A compact, colour-coded tag for the source origin (PubMed vs ClinicalTrials).
function sourceTypeClasses(type: string): string {
  const normalized = type.toLowerCase();
  if (normalized.includes("clinical") || normalized.includes("ctgov")) {
    return "bg-emerald-50 text-emerald-700 border-emerald-200";
  }
  if (normalized.includes("pubmed")) {
    return "bg-sky-50 text-sky-700 border-sky-200";
  }
  return "bg-ink/5 text-ink/60 border-ink/15";
}

export function SourcePicker({
  onChange,
  initialSelectedIds,
  maxSelected,
  label = "Search cached sources",
}: SourcePickerProps) {
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [results, setResults] = useState<CachedSource[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Selection is stored as an ordered list of ids plus a lookup of the source
  // rows we have seen, so selected chips can render even after the query changes
  // and a source drops out of the current result page.
  const [selectedIds, setSelectedIds] = useState<string[]>(
    () => Array.from(new Set(initialSelectedIds ?? []))
  );
  const [known, setKnown] = useState<Record<string, CachedSource>>({});

  // Keep the latest onChange without re-subscribing effects to a new identity.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // Report selection changes to the parent.
  useEffect(() => {
    onChangeRef.current(selectedIds);
  }, [selectedIds]);

  // Debounce the query.
  useEffect(() => {
    const handle = setTimeout(() => setDebouncedQ(q.trim()), DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [q]);

  // Run the source search whenever the debounced query changes. An empty query
  // still lists the most recently fetched sources (the endpoint returns the
  // newest rows), which gives the reviewer something to pick from immediately.
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetchSources(debouncedQ, controller.signal)
      .then((items) => {
        setResults(items);
        setKnown((prev) => {
          const next = { ...prev };
          for (const item of items) {
            next[item.id] = item;
          }
          return next;
        });
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") {
          return;
        }
        setError(err instanceof Error ? err.message : "Something went wrong.");
        setResults([]);
        setLoading(false);
      });
    return () => controller.abort();
  }, [debouncedQ]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const atCap =
    maxSelected !== undefined && selectedIds.length >= maxSelected;

  const toggle = useCallback(
    (source: CachedSource) => {
      setKnown((prev) => ({ ...prev, [source.id]: source }));
      setSelectedIds((prev) => {
        if (prev.includes(source.id)) {
          return prev.filter((id) => id !== source.id);
        }
        if (maxSelected !== undefined && prev.length >= maxSelected) {
          return prev;
        }
        return [...prev, source.id];
      });
    },
    [maxSelected]
  );

  const remove = useCallback((id: string) => {
    setSelectedIds((prev) => prev.filter((sid) => sid !== id));
  }, []);

  const clearAll = useCallback(() => {
    setSelectedIds([]);
  }, []);

  const selectedSources = useMemo(
    () =>
      selectedIds.map(
        (id): CachedSource =>
          known[id] ?? {
            id,
            source_type: "source",
            external_id: id,
            title: null,
            url: "",
          }
      ),
    [selectedIds, known]
  );

  return (
    <div className="space-y-3">
      <div>
        <label
          htmlFor="source-picker-search"
          className="block text-xs font-medium uppercase tracking-wide text-ink/40"
        >
          {label}
        </label>
        <input
          id="source-picker-search"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by title, PMID, or NCT id…"
          autoComplete="off"
          className="mt-1 w-full rounded-md border border-ink/15 bg-white px-3 py-2 text-sm text-ink placeholder:text-ink/40 focus:border-accent focus:outline-none"
          aria-describedby="source-picker-status"
        />
      </div>

      {selectedSources.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {selectedSources.map((source) => (
            <span
              key={source.id}
              className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-accent/30 bg-accent/5 py-1 pl-2.5 pr-1 text-xs text-ink/80"
            >
              <span className="truncate">{displayTitle(source)}</span>
              <button
                type="button"
                onClick={() => remove(source.id)}
                aria-label={`Remove ${displayTitle(source)}`}
                className="flex h-4 w-4 items-center justify-center rounded-full text-ink/40 hover:bg-accent/20 hover:text-ink/80 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
              >
                &times;
              </button>
            </span>
          ))}
          <button
            type="button"
            onClick={clearAll}
            className="ml-1 text-xs text-ink/40 underline underline-offset-2 hover:text-ink/70"
          >
            Clear all
          </button>
        </div>
      ) : null}

      <div
        className="max-h-64 overflow-y-auto rounded-md border border-ink/10 bg-white"
        role="listbox"
        aria-label="Cached sources"
        aria-multiselectable="true"
      >
        {loading ? (
          <p
            id="source-picker-status"
            className="px-3 py-6 text-center text-sm text-ink/40"
          >
            Loading sources…
          </p>
        ) : error ? (
          <p
            id="source-picker-status"
            role="alert"
            className="px-3 py-6 text-center text-sm text-red-700"
          >
            {error}
          </p>
        ) : results.length === 0 ? (
          <p
            id="source-picker-status"
            className="px-3 py-6 text-center text-sm text-ink/40"
          >
            {debouncedQ.length > 0
              ? `No cached sources match “${debouncedQ}”.`
              : "No cached sources yet. Ingest sources first."}
          </p>
        ) : (
          <ul className="divide-y divide-ink/5">
            {results.map((source) => {
              const checked = selectedSet.has(source.id);
              const disabled = !checked && atCap;
              return (
                <li key={source.id}>
                  <label
                    className={`flex cursor-pointer items-start gap-3 px-3 py-2 text-left hover:bg-paper ${
                      disabled ? "cursor-not-allowed opacity-50" : ""
                    }`}
                  >
                    <input
                      type="checkbox"
                      role="option"
                      aria-selected={checked}
                      checked={checked}
                      disabled={disabled}
                      onChange={() => toggle(source)}
                      className="mt-0.5 h-4 w-4 shrink-0 rounded border-ink/30 text-accent focus:ring-accent"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-ink/80">
                        {displayTitle(source)}
                      </span>
                      <span className="mt-1 flex items-center gap-2">
                        <span
                          className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${sourceTypeClasses(
                            source.source_type
                          )}`}
                        >
                          {source.source_type}
                        </span>
                        <span className="truncate font-mono text-[11px] text-ink/40">
                          {source.external_id}
                        </span>
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <p className="text-xs text-ink/40" aria-live="polite">
        {selectedIds.length} selected
        {maxSelected !== undefined ? ` of ${maxSelected} max` : ""}.
      </p>
    </div>
  );
}
