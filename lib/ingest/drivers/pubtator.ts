// PubTator ingest driver — wraps lib/bio/pubtator.annotatePmids / annotateText into a
// cacheable source record of the normalized bio-entities PubTator resolved.
//
// PubTator normalizes free text (or an already-indexed PMID) to database-qualified entity
// ids. This driver annotates the context's query text (or a PMID it recognizes in the
// entity/query) and folds the resolved entities into one cacheable source record. When
// PubTator returns nothing, it returns [] (honest empty) — never a fabricated entity. NO
// LLM; every entity/id is exactly what PubTator returned (public NCBI service).

import { annotatePmids, annotateText, normalizeEntities } from "@/lib/bio/pubtator";
import type { BioEntity, NormalizedEntityGroup, PmidAnnotation } from "@/lib/bio/entities.schemas";
import type { CacheableSourceRecord, DriverContext, IngestDriver } from "./types";

const SOURCE_TYPE = "pubtator";
const LICENSE = "NCBI PubTator3 (public NCBI service).";
// Cap entities folded into the summary text so a dense passage can't balloon the record.
const MAX_ENTITIES_IN_TEXT = 25;

// A bare PMID (digits) we can annotate via the pre-computed export path.
const PMID_RE = /^\d{1,9}$/;

// Pull a PMID out of the context (entity curie/surface or query) when one is present.
function pmidFrom(context: DriverContext): string | null {
  const candidates = [context.entityCurie, context.entitySurface, context.query]
    .map((c) => (typeof c === "string" ? c.trim() : ""))
    .filter((c) => c.length > 0);
  for (const c of candidates) {
    if (PMID_RE.test(c)) return c;
  }
  return null;
}

// The text to annotate on-the-fly: the free-text query.
function textFrom(context: DriverContext): string | null {
  const query = context.query?.trim();
  if (query && query.length >= 3 && !PMID_RE.test(query)) return query;
  return null;
}

// Flatten the per-document annotations into a single normalized-entity group list.
function groupEntities(annotations: PmidAnnotation[]): NormalizedEntityGroup[] {
  const all: BioEntity[] = [];
  for (const doc of annotations) all.push(...doc.entities);
  return normalizeEntities(all);
}

// Deterministic summary line for one normalized entity group.
function describeGroup(group: NormalizedEntityGroup): string {
  const surface = group.mentions[0] ?? group.type;
  const id = group.normalizedId ?? "unlinked";
  return `${surface} [${group.type}:${id}]`;
}

export const pubtatorDriver: IngestDriver = {
  sourceType: SOURCE_TYPE,
  async fetch(context: DriverContext): Promise<CacheableSourceRecord[]> {
    const pmid = pmidFrom(context);
    const text = pmid ? null : textFrom(context);
    if (!pmid && !text) return [];

    const annotations = pmid
      ? await annotatePmids([pmid]).catch(() => [] as PmidAnnotation[])
      : await annotateText(text as string).catch(() => [] as PmidAnnotation[]);

    const groups = groupEntities(annotations);
    if (groups.length === 0) return [];

    // A stable external id: the PMID when annotating an indexed article, else a content
    // digest of the annotated text (deterministic — same text caches once).
    const externalId = pmid ? `pmid:${pmid}` : `text:${digest(text as string)}`;

    const capped = groups.slice(0, MAX_ENTITIES_IN_TEXT);
    const rawText =
      `PubTator normalized ${groups.length} distinct bio-entities` +
      (pmid ? ` in PMID ${pmid}` : "") +
      `: ${capped.map(describeGroup).join("; ")}.`;

    return [
      {
        source_type: SOURCE_TYPE,
        external_id: externalId,
        title: pmid ? `PubTator entities: PMID ${pmid}` : "PubTator entities (text)",
        raw_text: rawText,
        url: pmid
          ? `https://www.ncbi.nlm.nih.gov/research/pubtator3/publication/${pmid}`
          : "https://www.ncbi.nlm.nih.gov/research/pubtator3/",
        metadata: {
          license: LICENSE,
          sourceVersion: "PubTator3 API",
          extra: {
            pmid,
            entityGroupCount: groups.length,
            types: Array.from(new Set(groups.map((g) => g.type))),
          },
        },
      },
    ];
  },
};

// A short, deterministic hex digest of the annotated text — used only to key the cache
// row for on-the-fly annotations. NOT a security hash; a simple FNV-1a over the string so
// the same text yields the same id without pulling in a crypto import here (the pipeline
// owns the audit-grade snapshot hash separately). Pure — no wall clock.
function digest(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
