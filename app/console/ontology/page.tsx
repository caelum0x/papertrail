"use client";

import { useCallback, useState } from "react";
import type { ApiResponse } from "@/lib/api/response";
import { ModuleHeader } from "../claims/_components/ModuleHeader";
import { ErrorBanner, LoadingBanner } from "@/components/console/StateBanners";
import type {
  CanonicalEntity,
  MarkerCheckResult,
  MarkerPanel,
} from "./_components/types";

// Ontology console. Resolve a biomedical surface form (gene symbol, disease,
// cell type) to its canonical CURIE + xrefs via the DETERMINISTIC resolver
// (/api/entities/canonicalize — synonym-exact, no LLM, null on an honest miss),
// then show any curated cell-marker memberships for it (/api/bio/marker-check).
// Both are PUBLIC compute routes; the fetches carry no auth/org header.

interface Resolution {
  surface: string;
  entity: CanonicalEntity | null;
  panels: MarkerPanel[];
}

const EXAMPLE_SURFACES = ["CD19", "HER2", "heart attack"];

export default function OntologyPage() {
  const [surface, setSurface] = useState("");
  const [result, setResult] = useState<Resolution | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (value: string) => {
      const trimmed = value.trim();
      if (trimmed.length === 0 || loading) return;

      setLoading(true);
      setError(null);
      setResult(null);
      try {
        // 1. Deterministic canonicalization (public route, no auth header).
        const canonRes = await fetch("/api/entities/canonicalize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ surface: trimmed }),
        });
        const canonJson = (await canonRes.json().catch(() => null)) as
          | ApiResponse<CanonicalEntity | null>
          | null;
        if (!canonJson) throw new Error("Unexpected server response.");
        if (!canonRes.ok || !canonJson.success) {
          throw new Error(canonJson.error ?? "The canonicalization request failed.");
        }
        const entity = canonJson.data ?? null;

        // 2. Curated marker memberships for the surface (best-effort; a marker
        //    lookup failure must not hide a successful resolution).
        let panels: MarkerPanel[] = [];
        try {
          const markerRes = await fetch("/api/bio/marker-check", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ gene: trimmed }),
          });
          const markerJson = (await markerRes.json().catch(() => null)) as
            | ApiResponse<MarkerCheckResult>
            | null;
          if (markerRes.ok && markerJson?.success && markerJson.data) {
            panels = markerJson.data.panels ?? [];
          }
        } catch {
          panels = [];
        }

        setResult({ surface: trimmed, entity, panels });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to resolve the entity.");
      } finally {
        setLoading(false);
      }
    },
    [loading]
  );

  return (
    <div>
      <ModuleHeader
        title="Ontology"
        subtitle="Resolve a symbol to its canonical CURIE and cross-references, then see its curated marker memberships. Deterministic — no LLM in the linking path."
      />

      <form
        className="mt-6"
        onSubmit={(e) => {
          e.preventDefault();
          void run(surface);
        }}
      >
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={surface}
            onChange={(e) => setSurface(e.target.value)}
            maxLength={200}
            placeholder="Enter a symbol, disease, or cell type — e.g. CD19"
            className="min-w-[16rem] flex-1 rounded-lg border border-ink/15 bg-white px-4 py-2.5 text-sm text-ink placeholder:text-ink/40 focus:border-accent focus:outline-none"
          />
          <button
            type="submit"
            disabled={loading || surface.trim().length === 0}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40"
          >
            {loading ? "Resolving…" : "Resolve"}
          </button>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {EXAMPLE_SURFACES.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => {
                setSurface(ex);
                void run(ex);
              }}
              className="rounded-md border border-ink/15 bg-white px-3 py-1.5 text-xs text-ink/60 hover:text-ink"
            >
              {ex}
            </button>
          ))}
        </div>
      </form>

      <div className="mt-6 space-y-4">
        {loading ? (
          <LoadingBanner message="Resolving the surface against the ontology and curated panels…" />
        ) : null}
        {error ? <ErrorBanner message={error} /> : null}
        {result ? <ResolutionView result={result} /> : null}
      </div>
    </div>
  );
}

function ResolutionView({ result }: { result: Resolution }) {
  return (
    <div className="space-y-4">
      {result.entity ? (
        <EntityCard entity={result.entity} />
      ) : (
        <div className="rounded-lg border border-ink/15 bg-paper p-4">
          <p className="text-sm font-medium text-ink/70">No canonical term resolved</p>
          <p className="mt-1 text-xs text-ink/50">
            “{result.surface}” did not match any curated ontology synonym. This is an honest
            miss — no CURIE was fabricated.
          </p>
        </div>
      )}

      <MarkerPanels surface={result.surface} panels={result.panels} />
    </div>
  );
}

function EntityCard({ entity }: { entity: CanonicalEntity }) {
  return (
    <div className="rounded-lg border border-ink/15 bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink">{entity.canonicalLabel}</h2>
        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
          score {entity.score.toFixed(2)}
        </span>
      </div>
      <dl className="mt-3 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
        <Field label="CURIE" value={<code className="text-ink">{entity.curie}</code>} />
        <Field label="Ontology" value={entity.ontology} />
        <Field label="Term type" value={entity.termType ?? "—"} />
      </dl>

      <div className="mt-3 border-t border-ink/15 pt-3">
        <p className="text-xs font-medium text-ink/60">Cross-references</p>
        {entity.xrefs.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {entity.xrefs.map((xref) => (
              <span
                key={xref}
                className="rounded border border-ink/15 bg-paper px-2 py-0.5 text-xs text-ink/70"
              >
                {xref}
              </span>
            ))}
          </div>
        ) : (
          <p className="mt-1 text-xs text-ink/40">No cross-references recorded.</p>
        )}
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-ink/40">{label}</dt>
      <dd className="mt-0.5 text-ink/80">{value}</dd>
    </div>
  );
}

function MarkerPanels({
  surface,
  panels,
}: {
  surface: string;
  panels: MarkerPanel[];
}) {
  return (
    <div className="rounded-lg border border-ink/15 bg-white p-4">
      <h3 className="text-sm font-semibold text-ink">Marker memberships</h3>
      {panels.length > 0 ? (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-ink/15 text-ink/40">
                <th className="py-1.5 pr-3 font-medium">Cell type</th>
                <th className="py-1.5 pr-3 font-medium">Gene</th>
                <th className="py-1.5 pr-3 font-medium">Direction</th>
                <th className="py-1.5 pr-3 font-medium">Tissue</th>
                <th className="py-1.5 pr-3 font-medium">Source</th>
              </tr>
            </thead>
            <tbody>
              {panels.map((panel, i) => (
                <tr key={panel.id ?? i} className="border-b border-ink/15 last:border-0">
                  <td className="py-1.5 pr-3 text-ink/80">{panel.cellTypeLabel ?? "—"}</td>
                  <td className="py-1.5 pr-3 text-ink/80">{panel.geneSymbol ?? "—"}</td>
                  <td className="py-1.5 pr-3 text-ink/70">{panel.direction ?? "—"}</td>
                  <td className="py-1.5 pr-3 text-ink/70">{panel.tissueLabel ?? "—"}</td>
                  <td className="py-1.5 pr-3 text-ink/60">
                    {panel.pmid ? (
                      <a
                        href={`https://pubmed.ncbi.nlm.nih.gov/${panel.pmid}/`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-accent hover:underline"
                      >
                        {panel.source ?? "PMID"}:{panel.pmid}
                      </a>
                    ) : (
                      (panel.source ?? "—")
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-2 text-xs text-ink/50">
          No curated marker panel documents “{surface}”. Absence here means the pairing is not
          in PaperTrail’s curated set — not evidence against it.
        </p>
      )}
    </div>
  );
}
