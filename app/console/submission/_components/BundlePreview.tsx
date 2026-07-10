"use client";

import type { BundleManifest, PooledEstimate } from "./types";

// Read-only preview of an assembled submission-bundle MANIFEST, laid out as the
// CTD/eCTD-style sections a regulatory reviewer expects: Summary of Findings,
// Methods, Evidence Table, Provenance Appendix, and an honest Gaps ledger. Purely
// presentational — every value shown is copied straight from the manifest the
// deterministic assembler returned. Uses house theme tokens (bg-paper / text-ink /
// text-accent / border-ink/15).

function round(n: number, dp = 2): string {
  const f = 10 ** dp;
  return String(Math.round(n * f) / f);
}

function formatEstimate(e: PooledEstimate): string {
  return `${round(e.point)} (${round(e.ci_lower)}–${round(e.ci_upper)}), ${e.ci_pct}% CI`;
}

function shortHash(hash: string): string {
  return hash.length > 16 ? `${hash.slice(0, 12)}…${hash.slice(-4)}` : hash;
}

function SectionHeading({ index, title }: { index: string; title: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="font-mono text-xs text-accent">{index}</span>
      <h3 className="text-sm font-semibold text-ink/80">{title}</h3>
    </div>
  );
}

function CertaintyBadge({ value }: { value: string | null }) {
  if (!value) return null;
  const label = value.replace(/_/g, " ");
  return (
    <span className="rounded-full bg-paper px-2 py-0.5 text-xs font-medium text-ink/70 ring-1 ring-inset ring-ink/15">
      {label}
    </span>
  );
}

export function BundlePreview({ manifest }: { manifest: BundleManifest }) {
  const c = manifest.counts;
  return (
    <div className="space-y-6">
      {/* Manifest header / integrity seal */}
      <div className="rounded-lg border border-ink/15 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-ink/80">
            Submission bundle manifest
          </h2>
          <span
            className="font-mono text-xs text-ink/50"
            title="Deterministic sha256 over the manifest body (no wall-clock input)."
          >
            hash {shortHash(manifest.bundle_hash)}
          </span>
        </div>
        <p className="mt-2 text-xs text-ink/40">
          Generated {new Date(manifest.generated_at).toLocaleString()} ·{" "}
          {c.verifications_included} verification
          {c.verifications_included === 1 ? "" : "s"} ·{" "}
          {c.evidence_reports_included} evidence report
          {c.evidence_reports_included === 1 ? "" : "s"} · {c.grounded_spans}{" "}
          grounded span{c.grounded_spans === 1 ? "" : "s"}
          {c.dropped_ungroundable_spans > 0
            ? ` · ${c.dropped_ungroundable_spans} span${
                c.dropped_ungroundable_spans === 1 ? "" : "s"
              } dropped`
            : ""}
          {c.gaps > 0 ? ` · ${c.gaps} gap${c.gaps === 1 ? "" : "s"}` : ""}
        </p>
      </div>

      {/* Module 2.5 — Summary of Findings */}
      <section className="rounded-lg border border-ink/15 bg-white p-4">
        <SectionHeading index="M2.5" title="Summary of findings" />
        {manifest.summary_of_findings.length === 0 ? (
          <p className="mt-3 text-sm text-ink/40">No findings included.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-ink/15 text-xs uppercase tracking-wide text-ink/40">
                  <th className="py-2 pr-3 font-medium">Claim</th>
                  <th className="py-2 pr-3 font-medium">Verdict / discrepancy</th>
                  <th className="py-2 pr-3 font-medium">Certainty / trust</th>
                  <th className="py-2 font-medium">Spans</th>
                </tr>
              </thead>
              <tbody>
                {manifest.summary_of_findings.map((row) => (
                  <tr key={`${row.kind}-${row.ref_id}`} className="border-b border-ink/15 align-top">
                    <td className="py-2 pr-3 text-ink/80">{row.claim}</td>
                    <td className="py-2 pr-3 text-ink/70">
                      {row.kind === "verification"
                        ? (row.discrepancy_type ?? "—").replace(/_/g, " ")
                        : (row.verdict ?? "—").replace(/_/g, " ")}
                    </td>
                    <td className="py-2 pr-3">
                      {row.kind === "verification" ? (
                        <span className="text-ink/70">
                          {row.trust_score === null ? "—" : `${row.trust_score}/100`}
                        </span>
                      ) : (
                        <CertaintyBadge value={row.certainty} />
                      )}
                    </td>
                    <td className="py-2 text-ink/60">{row.grounded_spans}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Module 2.5 — Methods */}
      <section className="rounded-lg border border-ink/15 bg-white p-4">
        <SectionHeading index="M2.5" title="Methods (deterministic engines)" />
        {manifest.methods.length === 0 ? (
          <p className="mt-3 text-sm text-ink/40">No methods to declare.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {manifest.methods.map((m) => (
              <li key={m.engine}>
                <p className="text-sm font-medium text-ink/80">{m.engine}</p>
                <p className="mt-0.5 text-xs text-ink/50">{m.description}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Module 5 — Evidence table */}
      <section className="rounded-lg border border-ink/15 bg-white p-4">
        <SectionHeading index="M5" title="Evidence table (pooled estimates)" />
        {manifest.evidence_table.length === 0 ? (
          <p className="mt-3 text-sm text-ink/40">
            No pooled quantitative estimate included in this bundle.
          </p>
        ) : (
          <div className="mt-3 space-y-4">
            {manifest.evidence_table.map((e, i) => (
              <div key={i} className="rounded-md bg-paper p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm text-ink/80">
                    <span className="font-medium">{e.measure}</span>{" "}
                    {formatEstimate(e)}
                  </p>
                  <CertaintyBadge value={e.certainty} />
                </div>
                <p className="mt-1 text-xs text-ink/50">
                  {e.studies} stud{e.studies === 1 ? "y" : "ies"} · I² ={" "}
                  {round(e.i_squared, 1)}% ·{" "}
                  {e.significant
                    ? "95% CI excludes the null"
                    : "95% CI crosses the null"}
                </p>
                {e.downgrades.length > 0 ? (
                  <ul className="mt-2 list-disc pl-5 text-xs text-ink/50">
                    {e.downgrades.map((d, j) => (
                      <li key={j}>
                        <span className="font-medium">
                          {d.domain.replace(/_/g, " ")} (−{d.steps})
                        </span>{" "}
                        {d.reason}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-xs text-ink/40">No GRADE downgrades applied.</p>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Provenance appendix — chain of custody */}
      <section className="rounded-lg border border-ink/15 bg-white p-4">
        <SectionHeading index="App." title="Provenance appendix (chain of custody)" />
        {manifest.provenance_appendix.length === 0 ? (
          <p className="mt-3 text-sm text-ink/40">
            No chain-of-custody records — no verification with a grounded source was included.
          </p>
        ) : (
          <div className="mt-3 space-y-4">
            {manifest.provenance_appendix.map((cust) => (
              <div key={cust.verification_id} className="rounded-md bg-paper p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-mono text-xs text-ink/60">
                    verification {cust.verification_id.slice(0, 8)}
                  </p>
                  <span className="font-mono text-xs text-ink/50" title="Aggregate custody hash.">
                    agg {shortHash(cust.aggregate_hash)}
                  </span>
                </div>
                <p className="mt-1 text-xs text-ink/50">
                  source {cust.source_id ? cust.source_id.slice(0, 8) : "—"}
                  {cust.pmid ? ` · PMID ${cust.pmid}` : ""}
                  {cust.doi ? ` · DOI ${cust.doi}` : ""}
                  {cust.source_version ? ` · v${cust.source_version}` : ""}
                  {cust.dropped_ungroundable > 0
                    ? ` · ${cust.dropped_ungroundable} dropped`
                    : ""}
                </p>
                {cust.records.length > 0 ? (
                  <ul className="mt-2 space-y-2">
                    {cust.records.map((r) => (
                      <li
                        key={r.chain_of_custody_hash}
                        className="rounded border border-ink/15 bg-white p-2"
                      >
                        <p className="text-xs text-ink/70">“{r.source_span}”</p>
                        <p className="mt-1 font-mono text-[11px] text-ink/40">
                          [{r.span_start}–{r.span_end}] · {shortHash(r.chain_of_custody_hash)}
                          {r.content_hash ? ` · content ${shortHash(r.content_hash)}` : ""}
                        </p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-xs text-ink/40">
                    No span grounded to the current source text.
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Honesty ledger — gaps */}
      {manifest.gaps.length > 0 ? (
        <section className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <h3 className="text-sm font-semibold text-amber-800">
            Gaps ({manifest.gaps.length}) — what could not be assembled
          </h3>
          <ul className="mt-2 space-y-1.5">
            {manifest.gaps.map((g, i) => (
              <li key={i} className="text-xs text-amber-800">
                <span className="font-medium">{g.kind.replace(/_/g, " ")}</span>
                {g.ref_id ? ` (${g.ref_id.slice(0, 8)})` : ""}: {g.detail}
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <section className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
          <p className="text-xs text-emerald-800">
            No gaps — every requested artefact was assembled with grounded provenance.
          </p>
        </section>
      )}
    </div>
  );
}
