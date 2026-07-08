"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchSearch } from "@/components/search/api";
import type { SearchResponse, SearchResult } from "@/components/search/types";
import { SearchTypeBadge } from "@/components/search/SearchTypeBadge";

export interface GlobalSearchProps {
  open: boolean;
  onClose: () => void;
}

// Command-palette-style overlay for global search. Opens as a modal, debounces
// the query, renders grouped results, and supports arrow-key navigation +
// Enter to open a result and Escape to close.
export function GlobalSearch({ open, onClose }: GlobalSearchProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [data, setData] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  // Flatten grouped results into a single ordered list for keyboard nav.
  const flatResults = useMemo<SearchResult[]>(
    () => (data ? data.groups.flatMap((g) => g.results) : []),
    [data]
  );

  // Reset transient state each time the palette opens, and focus the input.
  useEffect(() => {
    if (open) {
      setActiveIndex(0);
      const handle = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(handle);
    }
    setQ("");
    setDebouncedQ("");
    setData(null);
    setError(null);
    return undefined;
  }, [open]);

  // Debounce the query.
  useEffect(() => {
    const handle = setTimeout(() => setDebouncedQ(q.trim()), 250);
    return () => clearTimeout(handle);
  }, [q]);

  useEffect(() => {
    setActiveIndex(0);
  }, [debouncedQ]);

  // Run the search whenever the debounced query changes.
  useEffect(() => {
    if (!open) {
      return undefined;
    }
    if (debouncedQ.length === 0) {
      setData(null);
      setError(null);
      setLoading(false);
      return undefined;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetchSearch({ q: debouncedQ, signal: controller.signal })
      .then((res) => {
        setData(res);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") {
          return;
        }
        setError(err instanceof Error ? err.message : "Something went wrong.");
        setData(null);
        setLoading(false);
      });
    return () => controller.abort();
  }, [debouncedQ, open]);

  const go = useCallback(
    (result: SearchResult) => {
      onClose();
      router.push(result.href);
    },
    [onClose, router]
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (flatResults.length === 0) {
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % flatResults.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => (i - 1 + flatResults.length) % flatResults.length);
      } else if (e.key === "Enter") {
        e.preventDefault();
        const target = flatResults[activeIndex];
        if (target) {
          go(target);
        }
      }
    },
    [flatResults, activeIndex, go, onClose]
  );

  if (!open) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-ink/30 px-4 pt-[10vh]"
      role="dialog"
      aria-modal="true"
      aria-label="Global search"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
      onKeyDown={onKeyDown}
    >
      <div className="w-full max-w-xl overflow-hidden rounded-lg border border-ink/10 bg-white shadow-xl">
        <div className="border-b border-ink/10 px-4 py-3">
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search claims, documents, evidence, verifications..."
            className="w-full bg-white text-sm text-ink/80 placeholder:text-ink/40 focus:outline-none"
            aria-label="Search"
          />
        </div>

        <div className="max-h-[50vh] overflow-y-auto">
          {debouncedQ.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-ink/40">
              Type to search across your workspace.
            </p>
          ) : loading ? (
            <p className="px-4 py-6 text-center text-sm text-ink/40">Searching...</p>
          ) : error ? (
            <p className="px-4 py-6 text-center text-sm text-red-600">{error}</p>
          ) : !data || data.total === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-ink/40">
              No results for “{debouncedQ}”.
            </p>
          ) : (
            <ul className="py-1">
              {data.groups.map((group) => (
                <li key={group.type}>
                  <p className="px-4 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-ink/40">
                    {group.label}
                  </p>
                  <ul>
                    {group.results.map((result) => {
                      const idx = flatResults.indexOf(result);
                      const active = idx === activeIndex;
                      return (
                        <li key={`${result.type}-${result.id}`}>
                          <button
                            type="button"
                            onMouseEnter={() => setActiveIndex(idx)}
                            onClick={() => go(result)}
                            className={`flex w-full items-center gap-3 px-4 py-2 text-left ${
                              active ? "bg-paper" : "bg-white"
                            } hover:bg-paper`}
                          >
                            <SearchTypeBadge type={result.type} />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm text-ink/80">
                                {result.title}
                              </span>
                              {result.snippet ? (
                                <span className="block truncate text-xs text-ink/40">
                                  {result.snippet}
                                </span>
                              ) : null}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-ink/10 px-4 py-2 text-[11px] text-ink/40">
          <span>Enter to open · Esc to close</span>
          <span>↑ ↓ to navigate</span>
        </div>
      </div>
    </div>
  );
}
