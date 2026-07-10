"use client";

import { useCallback, useMemo, useState } from "react";
import type { ApiResponse } from "@/lib/api/response";
import { ModuleHeader } from "../claims/_components/ModuleHeader";
import { LoadingBanner } from "@/components/console/StateBanners";
import { MechanismContextCard } from "./_components/MechanismContextCard";
import type { ContextedMechanismResult } from "./_components/types";

// Context-aware mechanism console: paste a source passage, and the mechanism assembler
// extracts causal statements (Claude proposes, code grounds + scores a deterministic
// belief), then each mechanism is tagged with the biological CONTEXT it was observed in —
// tissue, species, assay/system — every tag grounded to a verbatim source quote. A
// deterministic translation-confidence score (human in-vivo > animal in-vivo > in-vitro)
// de-risks preclinical→human extrapolation. Toggle "human in-vivo only" to keep just the
// mechanisms that translate directly. Nothing shown is ungrounded speculation.

export default function MechanismContextPage() {
  const [text, setText] = useState("");
  const [requireHumanInVivo, setRequireHumanInVivo] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ContextedMechanismResult | null>(null);

  const submit = useCallback(async () => {
    if (text.trim().length < 40) {
      setError("Enter a source passage of at least 40 characters.");
      setResult(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/mechanism/context-filter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: text.trim(),
          require_human_in_vivo: requireHumanInVivo,
        }),
      });
      const body = (await res.json().catch(() => null)) as ApiResponse<ContextedMechanismResult> | null;
      if (!body) {
        throw new Error("Unexpected server response.");
      }
      if (!res.ok || !body.success || !body.data) {
        throw new Error(body.error ?? "Mechanism-context extraction failed.");
      }
      setResult(body.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to extract mechanism context.");
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, [text, requireHumanInVivo]);

  const humanInVivoCount = useMemo(
    () =>
      (result?.statements ?? []).filter(
        (s) => s.context.species === "human" && s.context.assay === "in-vivo"
      ).length,
    [result]
  );

  return (
    <div className="space-y-6">
      <ModuleHeader
        title="Context-aware mechanism extraction"
        subtitle="Extract causal mechanisms and tag each with the tissue, species, and assay it was observed in — every tag grounded to a verbatim source quote — with a deterministic translation-confidence score for preclinical→human extrapolation."
      />

      <div className="rounded-lg border border-ink/15 bg-white p-4">
        <label className="block text-sm font-medium text-ink/70" htmlFor="source-text">
          Source passage
        </label>
        <textarea
          id="source-text"
          rows={6}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Paste an abstract or methods/results passage. e.g. In cultured murine hepatocytes, compound X inhibited JAK2 phosphorylation; in patients, treatment activated the STAT3 pathway in vivo."
          className="mt-1 w-full rounded-md border border-ink/15 bg-white px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none"
        />

        <div className="mt-4 flex items-center justify-between gap-4">
          <label className="flex items-center gap-2 text-sm text-ink/70">
            <input
              type="checkbox"
              checked={requireHumanInVivo}
              onChange={(e) => setRequireHumanInVivo(e.target.checked)}
              className="h-4 w-4 rounded border-ink/30 text-accent focus:ring-accent"
            />
            Human in-vivo only
          </label>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={loading}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {loading ? "Extracting…" : "Extract mechanisms"}
          </button>
        </div>

        {error ? (
          <p className="mt-3 text-sm text-red-700" role="alert">
            {error}
          </p>
        ) : null}
      </div>

      {loading ? (
        <LoadingBanner message="Assembling mechanisms and grounding biological context…" />
      ) : result ? (
        <div className="space-y-6">
          {/* Overview + honest counts */}
          <div className="rounded-lg border border-ink/15 bg-white p-4">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-ink/70">
                {result.statements.length} mechanism
                {result.statements.length === 1 ? "" : "s"}
              </h3>
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800">
                {humanInVivoCount} human in-vivo
              </span>
              {result.filteredHumanInVivo ? (
                <span className="rounded-full bg-ink/[0.05] px-2 py-0.5 text-xs font-medium text-ink/60">
                  Filtered to human in-vivo
                </span>
              ) : null}
            </div>
            <p className="mt-3 text-xs text-ink/40">
              {result.edgesUpserted} KG edge{result.edgesUpserted === 1 ? "" : "s"} persisted
              {result.groundingDroppedCount > 0
                ? ` · ${result.groundingDroppedCount} ungroundable statement${
                    result.groundingDroppedCount === 1 ? "" : "s"
                  } dropped`
                : ""}
              {result.contextTagsDroppedCount > 0
                ? ` · ${result.contextTagsDroppedCount} ungroundable context tag${
                    result.contextTagsDroppedCount === 1 ? "" : "s"
                  } dropped`
                : ""}
              {result.filteredOutCount > 0
                ? ` · ${result.filteredOutCount} non-human-in-vivo mechanism${
                    result.filteredOutCount === 1 ? "" : "s"
                  } filtered out`
                : ""}
            </p>
          </div>

          {/* Context-tagged mechanisms */}
          <section>
            <h3 className="mb-3 text-sm font-semibold text-ink/70">
              Mechanisms ({result.statements.length})
            </h3>
            {result.statements.length === 0 ? (
              <div className="rounded-lg border border-ink/15 bg-white p-6 text-center text-sm text-ink/40">
                {result.filteredHumanInVivo
                  ? "No human in-vivo mechanisms were grounded in this passage."
                  : "No mechanisms could be grounded in this passage."}
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {result.statements.map((statement, i) => (
                  <MechanismContextCard
                    key={`${statement.subj}-${statement.relation}-${statement.obj}-${i}`}
                    statement={statement}
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}
