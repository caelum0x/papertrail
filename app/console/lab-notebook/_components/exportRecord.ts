// Turn a saved experiment record into artifacts a scientist can drop into a real lab
// notebook or ELN: a pretty-printed JSON blob and a Markdown document. Pure, no I/O —
// the component owns clipboard/download side effects. Grounded quotes are preserved so
// the exported artifact carries the same provenance the UI shows.

import type { LabExperimentRecord, StructuredExperiment } from "./types";
import { checkReproducibility } from "@/lib/labNotebook/reproducibility";

/** Stable, pretty-printed JSON of the full saved record (metadata + grounded structure). */
export function recordToJson(record: LabExperimentRecord): string {
  const payload = {
    id: record.id,
    title: record.title,
    experiment_date: record.experimentDate,
    tags: record.tags,
    created_at: record.createdAt,
    structured: record.structured,
    raw_notes: record.rawNotes,
  };
  return JSON.stringify(payload, null, 2);
}

function reagentLine(r: StructuredExperiment["reagents"][number]): string {
  const meta = [
    r.vendor ? `vendor: ${r.vendor}` : null,
    r.catalog ? `cat#: ${r.catalog}` : null,
    r.amount ? `amount: ${r.amount}` : null,
  ]
    .filter((x): x is string => x !== null)
    .join(", ");
  const suffix = meta ? ` (${meta})` : "";
  return `- **${r.name}**${suffix}\n  - quoted: "${r.source_span}"`;
}

/**
 * Markdown rendering of a saved record. Grounded sections quote the notes verbatim;
 * inferred sections (objective, equipment, next steps, entities) are labelled as
 * auto-inferred so the artifact preserves the same trust distinction as the UI.
 */
export function recordToMarkdown(record: LabExperimentRecord): string {
  const s = record.structured;
  const lines: string[] = [];

  lines.push(`# ${record.title}`);
  const metaBits = [
    record.experimentDate ? `Date: ${record.experimentDate}` : null,
    record.tags.length > 0 ? `Tags: ${record.tags.join(", ")}` : null,
    `Saved: ${record.createdAt}`,
  ].filter((x): x is string => x !== null);
  lines.push(`_${metaBits.join(" · ")}_`);
  lines.push("");

  if (s.objective) {
    lines.push("## Objective _(auto-inferred)_");
    lines.push(s.objective);
    lines.push("");
  }

  if (s.protocol_steps.length > 0) {
    lines.push("## Protocol steps _(grounded)_");
    for (const step of s.protocol_steps) {
      lines.push(`${step.order}. ${step.text}`);
      lines.push(`   - quoted: "${step.source_span}"`);
    }
    lines.push("");
  }

  if (s.reagents.length > 0) {
    lines.push("## Reagents _(grounded)_");
    for (const r of s.reagents) lines.push(reagentLine(r));
    lines.push("");
  }

  const groundedTextSections: Array<[string, StructuredExperiment["samples"]]> = [
    ["Samples", s.samples],
    ["Observations", s.observations],
    ["Outcomes", s.outcomes],
  ];
  for (const [heading, items] of groundedTextSections) {
    if (items.length === 0) continue;
    lines.push(`## ${heading} _(grounded)_`);
    for (const item of items) {
      lines.push(`- ${item.text}`);
      lines.push(`  - quoted: "${item.source_span}"`);
    }
    lines.push("");
  }

  if (s.equipment.length > 0) {
    lines.push("## Equipment _(auto-inferred)_");
    for (const e of s.equipment) lines.push(`- ${e}`);
    lines.push("");
  }

  if (s.next_steps.length > 0) {
    lines.push("## Next steps _(auto-inferred)_");
    for (const n of s.next_steps) lines.push(`- ${n}`);
    lines.push("");
  }

  if (s.entities.length > 0) {
    lines.push("## Entities _(auto-inferred)_");
    for (const e of s.entities) lines.push(`- ${e.type}: ${e.name}`);
    lines.push("");
  }

  // Reproducibility check — a deterministic pass over the structured fields (no LLM, no
  // invented data). Carried into the exported artifact so the same "add for
  // reproducibility" hints the UI shows travel with the record into an ELN.
  const reproducibility = checkReproducibility(s);
  if (reproducibility.clean) {
    lines.push("## Reproducibility check _(deterministic)_");
    lines.push(
      "No reproducibility gaps found — reagent sources, controls and sample size are recorded."
    );
    lines.push("");
  } else {
    lines.push("## Reproducibility check — add for reproducibility _(deterministic)_");
    for (const hint of reproducibility.hints) {
      lines.push(`- **${hint.message}** ${hint.detail}`);
    }
    lines.push("");
  }

  lines.push("## Original raw notes");
  lines.push("```");
  lines.push(record.rawNotes);
  lines.push("```");

  return lines.join("\n");
}

/** A filesystem-safe slug for the download filename, derived from the title. */
export function slugForFilename(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || "experiment";
}
