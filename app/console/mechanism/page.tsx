"use client";

import { useCallback, useState } from "react";
import type { ApiResponse } from "@/lib/api/response";
import { ModuleHeader } from "../claims/_components/ModuleHeader";
import { ErrorBanner, LoadingBanner } from "@/components/console/StateBanners";
import type {
  MechanismAssemblyData,
  MechanismStatementView,
  SourceTier,
} from "./_components/types";

// Mechanism Assembly console (native INDRA port). Paste a passage of source text and
// Claude extracts causal mechanistic statements — subj -relation-> obj — with the exact
// sentence each was drawn from. Every evidence quote is GROUNDED verbatim in the source
// server-side (ungroundable quotes are dropped), each statement carries a DETERMINISTIC
// belief (1 - prod(1 - reliability)), and each is persisted as a provenance-bearing KG
// edge. The belief is code, not a model number.

const SEED_TEXT =
  "Sorafenib inhibits BRAF, blocking downstream signaling in the MAPK pathway. Activated BRAF phosphorylates MEK, which in turn activates ERK. In this model, ERK regulates cell proliferation, and BRAF binds to the scaffold protein KSR1 to form a signaling complex.";

const TIERS: { value: SourceTier; label: string }[] = [
  { value: "curated_database", label: "Curated database" },
  { value: "full_text", label: "Full text" },
  { value: "abstract", label: "Abstract" },
  { value: "preprint", label: "Preprint" },
];

const RELATION_STYLES: Record<string, string> = {
  activates: "bg-green-50 text-green-700 border-green-200",
  inhibits: "bg-red-50 text-red-700 border-red-200",
  phosphorylates: "bg-blue-50 text-blue-700 border-blue-200",
  binds: "bg-purple-50 text-purple-700 border-purple-200",
  regulates: "bg-amber-50 text-amber-700 border-amber-200",
};

function beliefPct(belief: number): string {
  return `${Math.round(belief * 100)}%`;
}

export default function MechanismPage() {
  const [text, setText] = useState(SEED_TEXT);
  const [tier, setTier] = useState<SourceTier>("abstract");
  const [data, setData] = useState<MechanismAssemblyData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    if (text.trim().length < 40) {
      setError("Paste a passage of at least 40 characters.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/mechanism", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text.trim(), tier }),
      });
      const parsed = (await res.json().catch(() => null)) as
        | ApiResponse<MechanismAssemblyData>
        | null;
      if (!parsed) throw new Error("Unexpected server response.");
      if (!res.ok || !parsed.success || !parsed.data) {
        throw new Error(parsed.error ?? "Mechanism assembly failed.");
      }
      setData(parsed.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to assemble mechanisms.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [text, tier]);

  return (
    <div className="space-y-6">
      <ModuleHeader
        title="Mechanism Assembly"
        subtitle="Extract causal mechanistic statements with grounded evidence and a deterministic belief score."
      />

      <div className="space-y-3 rounded-lg border border-ink/15 bg-white p-4">
        <label htmlFor="mechanism-text" className="block text-sm font-medium text-ink/70">
          Source text
        </label>
        <textarea
          id="mechanism-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={6}
          className="w-full rounded-md border border-ink/15 bg-paper px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none"
          placeholder="Paste an abstract or passage describing a mechanism…"
        />
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="mechanism-tier" className="text-sm text-ink/60">
            Source tier
          </label>
          <select
            id="mechanism-tier"
            value={tier}
            onChange={(e) => setTier(e.target.value as SourceTier)}
            className="rounded-md border border-ink/15 bg-paper px-2 py-1 text-sm text-ink focus:border-accent focus:outline-none"
          >
            {TIERS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={run}
            disabled={loading}
            className="ml-auto rounded-md bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {loading ? "Assembling…" : "Assemble mechanisms"}
          </button>
        </div>
      </div>

      {error ? <ErrorBanner message={error} /> : null}
      {loading ? <LoadingBanner message="Extracting and grounding mechanistic statements…" /> : null}

      {data && !loading ? (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-4 text-sm text-ink/60">
            <span>
              <span className="font-semibold text-ink/80">{data.statements.length}</span>{" "}
              statement{data.statements.length === 1 ? "" : "s"}
            </span>
            <span>
              <span className="font-semibold text-ink/80">{data.groundingDroppedCount}</span>{" "}
              dropped (ungroundable)
            </span>
            <span>
              <span className="font-semibold text-ink/80">{data.edgesUpserted}</span>{" "}
              KG edge{data.edgesUpserted === 1 ? "" : "s"} persisted
            </span>
          </div>

          {data.statements.length === 0 ? (
            <div className="rounded-lg border border-ink/15 bg-white p-6 text-sm text-ink/50">
              No grounded mechanistic statements found in this passage.
            </div>
          ) : (
            <ul className="space-y-3">
              {data.statements.map((stmt, i) => (
                <StatementCard key={`${stmt.subj}-${stmt.relation}-${stmt.obj}-${i}`} stmt={stmt} />
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

function StatementCard({ stmt }: { stmt: MechanismStatementView }) {
  const relClass =
    RELATION_STYLES[stmt.relation] ?? "bg-ink/5 text-ink/70 border-ink/15";
  return (
    <li className="rounded-lg border border-ink/15 bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-ink/80">{stmt.subj}</span>
        <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${relClass}`}>
          {stmt.relation}
        </span>
        <span className="font-medium text-ink/80">{stmt.obj}</span>
        <span
          className="ml-auto rounded-md bg-accent/10 px-2 py-0.5 text-xs font-semibold text-accent"
          title="Deterministic belief: 1 - product(1 - source reliability)"
        >
          belief {beliefPct(stmt.belief)}
        </span>
      </div>
      <ul className="mt-3 space-y-2">
        {stmt.evidence.map((ev, j) => (
          <li key={j} className="rounded-md border border-ink/15 bg-paper px-3 py-2 text-sm">
            <p className="text-ink/70">“{ev.quote}”</p>
            <p className="mt-1 text-xs text-ink/40">
              {ev.tier.replace("_", " ")} · grounded {ev.grounding.status} · chars{" "}
              {ev.grounding.start}–{ev.grounding.end}
            </p>
          </li>
        ))}
      </ul>
    </li>
  );
}
