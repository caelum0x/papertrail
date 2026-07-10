import type { SynthesisReportView } from "./types";

// Client-side, dependency-free serialization of a synthesis review to plain text for
// the Export button. The engine numbers and grounded prose already live on the report
// object; this just lays them out linearly. Kept separate from the render components
// so it's trivially testable and reusable.

function factsLines(report: SynthesisReportView): string[] {
  const f = report.facts;
  const lines: string[] = ["ENGINE FACTS"];
  if (f.poolable) {
    lines.push(`  Measure           : ${f.measure ?? "—"}`);
    lines.push(`  Studies (k)       : ${f.k ?? "—"}`);
    lines.push(
      `  Pooled estimate   : ${f.pooledPoint ?? "—"} (${f.pooledCiLower ?? "—"}–${f.pooledCiUpper ?? "—"})`
    );
    lines.push(`  Reduction         : ${f.pooledReductionPercent ?? "—"}%`);
    lines.push(`  Heterogeneity I²  : ${f.iSquared ?? "—"}%`);
    lines.push(`  GRADE certainty   : ${f.certainty ?? "—"}`);
    lines.push(`  Claim vs pool     : ${f.verdict ?? "—"}`);
  } else {
    lines.push(`  Pooling not possible: ${f.engineRationale}`);
  }
  return lines;
}

export function synthesisReportToText(report: SynthesisReportView): string {
  const idx = new Map(report.usedSources.map((s, i) => [s.id, i + 1]));
  const lines: string[] = [];
  lines.push(report.title);
  lines.push("=".repeat(72));
  lines.push(`Topic: ${report.topic}`);
  lines.push("");
  lines.push(...factsLines(report));
  lines.push("");

  for (const section of report.sections) {
    lines.push(section.heading.toUpperCase());
    if (section.sentences.length === 0) {
      lines.push("  (no source-grounded content)");
    } else {
      const paragraph = section.sentences
        .map((s) => {
          const cites =
            s.grounding && s.citations.length > 0
              ? " " +
                s.citations
                  .map((id) => `[${idx.get(id) ?? "?"}]`)
                  .join("")
              : "";
          return `${s.text}${cites}`;
        })
        .join(" ");
      lines.push(`  ${paragraph}`);
    }
    lines.push("");
  }

  lines.push("SOURCES");
  report.usedSources.forEach((s, i) => {
    lines.push(`  [${i + 1}] ${s.title ?? "(untitled)"} · ${s.source_type}`);
  });
  lines.push("");
  lines.push(
    `Dropped ungroundable sentences: ${report.droppedSentenceCount}. ` +
      "Every number above is computed by PaperTrail's deterministic evidence engine; " +
      "the prose is drafted by Claude and grounded to source spans."
  );

  return lines.join("\n");
}

// Trigger a browser download of the given text as a .txt file. No-op on the server.
export function downloadText(filename: string, text: string): void {
  if (typeof window === "undefined") return;
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
