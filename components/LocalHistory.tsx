"use client";

import { useEffect, useState } from "react";
import { getLocalHistory, clearLocalHistory } from "@/lib/localHistory";

interface LocalHistoryProps {
  onSelect: (claim: string) => void;
}

function truncate(text: string, max = 60): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

export function LocalHistory({ onSelect }: LocalHistoryProps) {
  const [history, setHistory] = useState<string[]>([]);

  useEffect(() => {
    setHistory(getLocalHistory());
  }, []);

  if (history.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-ink/60">Recent checks</span>
        <button
          type="button"
          onClick={() => {
            clearLocalHistory();
            setHistory([]);
          }}
          className="text-xs text-ink/40 hover:text-accent focus:text-accent focus:outline-none"
        >
          Clear
        </button>
      </div>
      <ul className="flex flex-wrap gap-2">
        {history.map((claim) => (
          <li key={claim}>
            <button
              type="button"
              title={claim}
              onClick={() => onSelect(claim)}
              className="rounded-full border border-ink/10 bg-white px-3 py-1 text-xs text-ink/70 hover:border-accent hover:text-accent focus:border-accent focus:outline-none"
            >
              {truncate(claim)}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
