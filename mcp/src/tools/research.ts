// Agentic research + knowledge tools for the PaperTrail MCP server.
//
// Each tool wraps one deployed PaperTrail compute route (POST, { success, data,
// error } envelope) so it can be driven from Anthropic Claude Science as a
// Connector. These are the "reasoning-heavy" endpoints: multi-agent deep
// research, grounded QA, structured extraction, knowledge-graph traversal and
// link prediction, evidence dossiers, and real-world-evidence signals.
//
// EVERY load-bearing number in these results comes from PaperTrail's
// deterministic engines, never from the LLM — Claude only plans/narrates/extracts
// candidate spans, and any claim that can't be grounded to an exact source span
// is dropped. Tools are read-only analyses (readOnlyHint) that reach the live
// PaperTrail deployment and, through it, external registries (openWorldHint).
//
// Several of these routes fan out many Claude + pipeline calls per request and
// run for a while (deep research especially); the default client timeout is
// 120s, which the descriptions flag so callers can raise PAPERTRAIL_* timeouts
// or expect a wait.

import { z } from "zod";
import type { PaperTrailClient } from "../client.js";
import {
  tool,
  formatResult,
  toErrorMessage,
  type PaperTrailTool,
} from "../registry.js";

// Shared read-only + open-world hints for every tool in this file. These routes
// analyse cached/live evidence and never mutate PaperTrail state, but they do
// reach the deployed API and external biomedical registries.
const READ_ONLY = { readOnlyHint: true, openWorldHint: true } as const;

// The vocabularies the underlying routes validate against — mirrored here so the
// MCP input schema rejects bad values before the network call rather than after.
const KG_PREDICATES = ["associates_with", "targets", "treats"] as const;
const KG_SCORERS = [
  "common_neighbors",
  "adamic_adar",
  "resource_allocation",
  "preferential_attachment",
] as const;
const SOURCE_TIERS = [
  "curated_database",
  "full_text",
  "abstract",
  "preprint",
] as const;
const SUBJECT_TYPES = ["target", "drug", "disease", "claim"] as const;

// -----------------------------------------------------------------------------
// paper_qa — POST /api/paper-qa  { question, limit? }
// -----------------------------------------------------------------------------

const paperQa = tool({
  name: "paper_qa",
  title: "Grounded Paper QA",
  description:
    "Answer a focused scientific question over PaperTrail's cached primary literature, with citations. " +
    "Claude retrieves the relevant papers, reads their full text, and returns an answer where every " +
    "rendered claim is grounded to an exact source span (PaperQA2-style); ungroundable claims are dropped. " +
    "USE WHEN you have a single, well-scoped factual question (e.g. 'What was the primary-endpoint hazard " +
    "ratio for empagliflozin in EMPA-REG?') and want a cited, source-anchored answer rather than a web guess. " +
    "Returns 'no_support_found' honestly when no cached source confidently supports an answer. Runs several " +
    "LLM + retrieval calls, so expect a few seconds.",
  annotations: READ_ONLY,
  inputSchema: {
    question: z
      .string()
      .min(10)
      .max(2000)
      .describe("A single focused scientific question (10-2000 chars)."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(8)
      .optional()
      .describe("Max papers to read (1-8). Omit for the default."),
  },
  handler: async (args, client): Promise<string> => {
    const schema = z.object({
      question: z.string().min(10).max(2000),
      limit: z.number().int().min(1).max(8).optional(),
    });
    try {
      const body = schema.parse(args);
      const data = await client.post<PaperQaResult>("/api/paper-qa", body);
      const summary =
        data.status === "no_support_found"
          ? "No cached source confidently supports an answer to this question."
          : `Answered with ${data.claims?.length ?? 0} grounded claim(s) across ${
              data.sources?.length ?? 0
            } source(s).`;
      return formatResult(summary, data);
    } catch (err) {
      return toErrorMessage(err);
    }
  },
});

interface PaperQaResult {
  status?: string;
  claims?: unknown[];
  sources?: unknown[];
}

// -----------------------------------------------------------------------------
// deep_research — POST /api/deep-research  { question }
// -----------------------------------------------------------------------------

const deepResearch = tool({
  name: "deep_research",
  title: "Multi-Agent Deep Research",
  description:
    "Run a grounded, multi-agent deep-research report on a research question (gpt-researcher / " +
    "open_deep_research style). Claude PLANS 3-6 focused sub-questions, the deterministic evidence " +
    "pipeline gathers verified pooled evidence for each, and Claude SYNTHESISES a structured, cited report " +
    "— every number from the engine, every claim grounded to an exact source span. " +
    "USE WHEN a question is broad enough to need decomposition and cross-source synthesis (e.g. 'What is the " +
    "cardiovascular safety profile of the GLP-1 receptor agonist class?'). " +
    "EXPENSIVE and SLOW: it fans out many Claude + pipeline calls and is heavily rate-limited. It can run " +
    "well beyond the default 120s client timeout — raise PAPERTRAIL_BASE_URL client timeout if the connector " +
    "supports it, and prefer paper_qa or synthesis_report for narrower asks.",
  annotations: READ_ONLY,
  inputSchema: {
    question: z
      .string()
      .min(10)
      .max(2000)
      .describe("A broad research question to decompose and investigate (10-2000 chars)."),
  },
  handler: async (args, client): Promise<string> => {
    const schema = z.object({ question: z.string().min(10).max(2000) });
    try {
      const body = schema.parse(args);
      const data = await client.post<DeepResearchResult>(
        "/api/deep-research",
        body
      );
      const summary = `Deep-research report: ${
        data.plan?.sub_questions?.length ?? 0
      } sub-question(s), ${data.supported_sub_questions ?? 0} supported, ${
        data.sources?.length ?? 0
      } source(s), ${data.sections?.length ?? 0} section(s).`;
      return formatResult(summary, data);
    } catch (err) {
      return toErrorMessage(err);
    }
  },
});

interface DeepResearchResult {
  plan?: { sub_questions?: unknown[] };
  sources?: unknown[];
  sections?: unknown[];
  supported_sub_questions?: number;
}

// -----------------------------------------------------------------------------
// research_brief — POST /api/research  { question }
// -----------------------------------------------------------------------------

const researchBrief = tool({
  name: "research_brief",
  title: "Native Deep-Research Brief",
  description:
    "Produce a cited research brief using PaperTrail's native parallel deep-research orchestrator over its " +
    "cached sources (plan -> parallel sub-query research -> per-source compression -> cited report), grounded " +
    "to real source spans. Similar intent to deep_research but a lighter, self-contained orchestration that " +
    "returns the plan, per-source compressed evidence, and a cited summary in one payload. " +
    "USE WHEN you want a fast, structured, cited overview of a topic against the cached corpus and don't need " +
    "the heavier full evidence pipeline. Runs multiple LLM calls, so expect a short wait.",
  annotations: READ_ONLY,
  inputSchema: {
    question: z
      .string()
      .min(10)
      .max(2000)
      .describe("The research question to brief (10-2000 chars)."),
  },
  handler: async (args, client): Promise<string> => {
    const schema = z.object({ question: z.string().min(10).max(2000) });
    try {
      const body = schema.parse(args);
      const data = await client.post<ResearchBriefResult>("/api/research", body);
      const summary = `Research brief: ${
        data.plan?.sub_questions?.length ?? 0
      } sub-question(s), ${data.report?.summary?.length ?? 0} summary claim(s).`;
      return formatResult(summary, data);
    } catch (err) {
      return toErrorMessage(err);
    }
  },
});

interface ResearchBriefResult {
  plan?: { sub_questions?: unknown[] };
  report?: { summary?: unknown[] };
}

// -----------------------------------------------------------------------------
// research_gaps_hypotheses — POST /api/hypotheses  { topic, query?, limit? }
// -----------------------------------------------------------------------------

const researchGapsHypotheses = tool({
  name: "research_gaps_hypotheses",
  title: "Research Gaps & Hypotheses",
  description:
    "Surface research gaps and testable hypotheses for a topic or claim, grounded in real evidence signals. " +
    "The route first runs the deterministic evidence pipeline (retrieve cached primary sources -> pool -> " +
    "meta-analysis / publication-bias / GRADE), then has Claude reason ONLY over those engine-established " +
    "signals — dropping any gap or hypothesis not anchored to a real signal. " +
    "USE WHEN a scientist wants to know 'what's missing' or 'what to test next' for a subject (e.g. topic " +
    "'PCSK9 inhibition in primary prevention') and needs the ideas tied to actual evidence, not free " +
    "speculation.",
  annotations: READ_ONLY,
  inputSchema: {
    topic: z
      .string()
      .min(10)
      .max(2000)
      .describe("The topic or claim to analyse for gaps (10-2000 chars)."),
    query: z
      .string()
      .min(1)
      .max(2000)
      .optional()
      .describe("Optional search-steering query to focus retrieval."),
    limit: z
      .number()
      .int()
      .positive()
      .max(20)
      .optional()
      .describe("Optional cap on retrieved candidate sources (1-20)."),
  },
  handler: async (args, client): Promise<string> => {
    const schema = z.object({
      topic: z.string().min(10).max(2000),
      query: z.string().min(1).max(2000).optional(),
      limit: z.number().int().positive().max(20).optional(),
    });
    try {
      const body = schema.parse(args);
      const data = await client.post<GapsResult>("/api/hypotheses", body);
      const summary = `Found ${data.gaps?.length ?? 0} gap(s) and ${
        data.hypotheses?.length ?? 0
      } hypothesis(es) across ${data.signals?.length ?? 0} evidence signal(s)${
        data.evidenceGrounded === false ? " (not evidence-grounded)" : ""
      }.`;
      return formatResult(summary, data);
    } catch (err) {
      return toErrorMessage(err);
    }
  },
});

interface GapsResult {
  gaps?: unknown[];
  hypotheses?: unknown[];
  signals?: unknown[];
  evidenceGrounded?: boolean;
}

// -----------------------------------------------------------------------------
// extract_paper — POST /api/extraction/paper  { text? | source_id? }
// -----------------------------------------------------------------------------

const extractPaper = tool({
  name: "extract_paper",
  title: "Structured Paper Extraction",
  description:
    "Extract structured findings from a paper: PICO, endpoints, and every reported effect size " +
    "(RobotReviewer / LlamaExtract-style). Claude reads the full text; the deterministic trust layer then " +
    "grounds each effect's quote to an exact source span and reconciles its number, dropping any effect it " +
    "can't ground. Provide EITHER 'text' (paste the abstract + results, up to 60k chars) OR 'source_id' (a " +
    "cached source UUID) — exactly one. " +
    "USE WHEN you need a machine-readable table of a study's outcomes and effect sizes rather than prose.",
  annotations: READ_ONLY,
  inputSchema: {
    text: z
      .string()
      .min(100)
      .max(60000)
      .optional()
      .describe("Full paper text (abstract + results). Provide this OR source_id."),
    source_id: z
      .string()
      .uuid()
      .optional()
      .describe("UUID of a cached PaperTrail source. Provide this OR text."),
  },
  handler: async (args, client): Promise<string> => {
    const schema = z
      .object({
        text: z.string().min(100).max(60000).optional(),
        source_id: z.string().uuid().optional(),
      })
      .refine((v) => Boolean(v.text) !== Boolean(v.source_id), {
        message: "Provide exactly one of 'text' or 'source_id'.",
      });
    try {
      const body = schema.parse(args);
      const data = await client.post<ExtractPaperResult>(
        "/api/extraction/paper",
        body
      );
      const summary = `Extracted ${data.endpoints?.length ?? 0} endpoint(s) and ${
        data.effects?.length ?? 0
      } grounded effect(s)${
        data.ungrounded_dropped_count
          ? ` (${data.ungrounded_dropped_count} ungrounded dropped)`
          : ""
      }.`;
      return formatResult(summary, data);
    } catch (err) {
      return toErrorMessage(err);
    }
  },
});

interface ExtractPaperResult {
  endpoints?: unknown[];
  effects?: unknown[];
  ungrounded_dropped_count?: number;
}

// -----------------------------------------------------------------------------
// assemble_mechanism — POST /api/mechanism  { text, tier? }
// -----------------------------------------------------------------------------

const assembleMechanism = tool({
  name: "assemble_mechanism",
  title: "Mechanistic Statement Assembly",
  description:
    "Extract causal mechanistic statements (subject-relation-object, e.g. 'drug X inhibits kinase Y') from a " +
    "passage and score them (native INDRA port). Claude proposes candidate tuples with an evidence quote; the " +
    "quote is grounded verbatim (ungroundable ones dropped), statements are de-duplicated, and each gets a " +
    "DETERMINISTIC belief = 1 - prod(1 - reliability_i). Each statement is persisted as a provenance-bearing " +
    "edge in the knowledge graph when the DB is available. " +
    "USE WHEN you want the machine-readable causal relationships (activates/inhibits/phosphorylates/binds/" +
    "regulates) stated in a piece of text, with an auditable belief score. Set 'tier' to declare how reliable " +
    "the source of the text is (defaults to 'abstract').",
  annotations: READ_ONLY,
  inputSchema: {
    text: z
      .string()
      .min(40)
      .max(20000)
      .describe("The source passage to extract mechanisms from (40-20000 chars)."),
    tier: z
      .enum(SOURCE_TIERS)
      .optional()
      .describe(
        "Provenance tier of the text, driving per-evidence reliability. Defaults to 'abstract'."
      ),
  },
  handler: async (args, client): Promise<string> => {
    const schema = z.object({
      text: z.string().min(40).max(20000),
      tier: z.enum(SOURCE_TIERS).optional(),
    });
    try {
      const body = schema.parse(args);
      const data = await client.post<MechanismResult>("/api/mechanism", body);
      const summary = `Assembled ${
        data.statements?.length ?? 0
      } mechanistic statement(s); ${data.edgesUpserted ?? 0} persisted as graph edge(s)${
        data.groundingDroppedCount
          ? ` (${data.groundingDroppedCount} ungrounded dropped)`
          : ""
      }.`;
      return formatResult(summary, data);
    } catch (err) {
      return toErrorMessage(err);
    }
  },
});

interface MechanismResult {
  statements?: unknown[];
  edgesUpserted?: number;
  groundingDroppedCount?: number;
}

// -----------------------------------------------------------------------------
// synthesis_report — POST /api/synthesis-report  { topic, query?, limit? }
// -----------------------------------------------------------------------------

const synthesisReport = tool({
  name: "synthesis_report",
  title: "Cited Evidence Synthesis Report",
  description:
    "Generate a long-form, fully-cited evidence review for a topic or claim (STORM-style). The deterministic " +
    "evidence pipeline supplies every number; Claude drafts the prose; every factual sentence is grounded to a " +
    "source span before it reaches you (ungrounded sentences dropped). " +
    "USE WHEN you want a readable narrative review with citations and a certainty read on a subject (e.g. " +
    "'statins and diabetes risk'), rather than a raw effect table or a single QA answer. Runs the full pipeline " +
    "plus drafting, so expect a short wait.",
  annotations: READ_ONLY,
  inputSchema: {
    topic: z
      .string()
      .min(10)
      .max(2000)
      .describe("The topic or claim to review (10-2000 chars)."),
    query: z
      .string()
      .min(1)
      .max(2000)
      .optional()
      .describe("Optional search-steering query to focus retrieval."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(20)
      .optional()
      .describe("Optional cap on retrieved candidate sources (1-20)."),
  },
  handler: async (args, client): Promise<string> => {
    const schema = z.object({
      topic: z.string().min(10).max(2000),
      query: z.string().min(1).max(2000).optional(),
      limit: z.number().int().min(1).max(20).optional(),
    });
    try {
      const body = schema.parse(args);
      const data = await client.post<SynthesisResult>(
        "/api/synthesis-report",
        body
      );
      const summary = `Evidence review over ${
        data.usedSources?.length ?? 0
      } source(s); certainty: ${data.facts?.certainty ?? "n/a"}${
        data.droppedSentenceCount
          ? ` (${data.droppedSentenceCount} ungrounded sentences dropped)`
          : ""
      }.`;
      return formatResult(summary, data);
    } catch (err) {
      return toErrorMessage(err);
    }
  },
});

interface SynthesisResult {
  usedSources?: unknown[];
  droppedSentenceCount?: number;
  facts?: { certainty?: string | null };
}

// -----------------------------------------------------------------------------
// knowledge_graph — POST /api/kg  { ingest?: {text} | path?: {from,to,maxHops?} }
// -----------------------------------------------------------------------------

const knowledgeGraph = tool({
  name: "knowledge_graph",
  title: "Biomedical Evidence Knowledge Graph",
  description:
    "Work with PaperTrail's biomedical evidence knowledge graph. Exactly one mode per call: " +
    "'ingest' grounds free text to normalized entities (PubTator) and derives typed, provenance-bearing edges " +
    "from the deterministic bio-relation engines (genetic association, Open Targets), persisting nodes + edges; " +
    "'path' returns a provenance-annotated evidence path between two normalized entity ids (or null if none). " +
    "No LLM sits in any edge confidence — entity linking is PubTator's, edge scores are the bio engines'. " +
    "USE 'ingest' to grow the graph from a passage; USE 'path' to ask 'how is entity A connected to entity B?' " +
    "(e.g. from an EFO disease id to an Ensembl gene id). Requires the graph DB to be configured.",
  annotations: READ_ONLY,
  inputSchema: {
    ingest: z
      .object({
        text: z
          .string()
          .min(1)
          .max(10000)
          .describe("Free text to ground and derive edges from (1-10000 chars)."),
      })
      .optional()
      .describe("Ingest mode. Provide this OR 'path', not both."),
    path: z
      .object({
        from: z
          .string()
          .min(1)
          .max(128)
          .describe("Normalized entity id to start from."),
        to: z
          .string()
          .min(1)
          .max(128)
          .describe("Normalized entity id to reach."),
        maxHops: z
          .number()
          .int()
          .min(1)
          .max(6)
          .optional()
          .describe("Max edges in the path (1-6). Omit for the default."),
      })
      .optional()
      .describe("Path mode. Provide this OR 'ingest', not both."),
  },
  handler: async (args, client): Promise<string> => {
    const schema = z
      .object({
        ingest: z.object({ text: z.string().min(1).max(10000) }).optional(),
        path: z
          .object({
            from: z.string().min(1).max(128),
            to: z.string().min(1).max(128),
            maxHops: z.number().int().min(1).max(6).optional(),
          })
          .optional(),
      })
      .refine((v) => Boolean(v.ingest) !== Boolean(v.path), {
        message: "Provide exactly one of 'ingest' or 'path'.",
      });
    try {
      const body = schema.parse(args);
      const data = await client.post<KgResult>("/api/kg", body);
      const summary =
        body.ingest !== undefined
          ? `Ingested graph: ${data.nodesUpserted ?? 0} node(s), ${
              data.edgesUpserted ?? 0
            } edge(s) upserted.`
          : data.found
          ? `Found an evidence path (${data.path?.hops ?? "?"} hop(s)).`
          : "No evidence path exists between those entities.";
      return formatResult(summary, data);
    } catch (err) {
      return toErrorMessage(err);
    }
  },
});

interface KgResult {
  nodesUpserted?: number;
  edgesUpserted?: number;
  found?: boolean;
  path?: { hops?: number } | null;
}

// -----------------------------------------------------------------------------
// kg_link_predict — POST /api/kg/predict  { from, predicate?, scorer?, radius?, limit? }
// -----------------------------------------------------------------------------

const kgLinkPredict = tool({
  name: "kg_link_predict",
  title: "Knowledge-Graph Link Prediction",
  description:
    "Predict NOVEL associations from a starting entity by ranking candidate object nodes on their structural " +
    "proximity in the evidence graph — a repurposing / hypothesis-generation list. Scorers are pure topology " +
    "math ported from PyKEEN's non-parametric baselines (common-neighbors, Adamic-Adar, resource-allocation, " +
    "preferential-attachment); NO LLM is in any score. When you pin a 'predicate', candidates are additionally " +
    "filtered to respect its Biolink domain/range, so ill-typed guesses are dropped. " +
    "USE WHEN you have a normalized entity id (from knowledge_graph ingest or a bio tool) and want ranked, " +
    "not-yet-linked candidates — e.g. novel drug->disease ('treats') or gene->disease ('associates_with') leads.",
  annotations: READ_ONLY,
  inputSchema: {
    from: z
      .string()
      .min(1)
      .max(128)
      .describe("Normalized entity id to predict links from."),
    predicate: z
      .enum(KG_PREDICATES)
      .optional()
      .describe(
        "Optional target relation; enforces Biolink well-typing on candidates."
      ),
    scorer: z
      .enum(KG_SCORERS)
      .optional()
      .describe("Topology scorer to rank candidates. Defaults to adamic_adar."),
    radius: z
      .number()
      .int()
      .min(1)
      .max(4)
      .optional()
      .describe("Neighborhood radius to consider (1-4)."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(200)
      .optional()
      .describe("Max predictions to return (1-200)."),
  },
  handler: async (args, client): Promise<string> => {
    const schema = z.object({
      from: z.string().min(1).max(128),
      predicate: z.enum(KG_PREDICATES).optional(),
      scorer: z.enum(KG_SCORERS).optional(),
      radius: z.number().int().min(1).max(4).optional(),
      limit: z.number().int().min(1).max(200).optional(),
    });
    try {
      const body = schema.parse(args);
      const data = await client.post<PredictResult>("/api/kg/predict", body);
      const summary =
        data.from === null
          ? "That source entity is not in the graph — no predictions."
          : `Ranked ${data.predictions?.length ?? 0} candidate link(s) via ${
              data.scorer ?? "adamic_adar"
            } for predicate '${data.predicate ?? "associates_with"}'.`;
      return formatResult(summary, data);
    } catch (err) {
      return toErrorMessage(err);
    }
  },
});

interface PredictResult {
  from?: unknown | null;
  predictions?: unknown[];
  scorer?: string;
  predicate?: string;
}

// -----------------------------------------------------------------------------
// extract_entities — POST /api/entities  { text }
// -----------------------------------------------------------------------------

const extractEntities = tool({
  name: "extract_entities",
  title: "Biomedical Entity Recognition & Linking",
  description:
    "Run biomedical NER + entity linking over a passage (native scispaCy port). Claude proposes candidate " +
    "gene/disease/chemical/variant mentions; a deterministic native linker maps each to a normalized concept id " +
    "(UMLS CUI / MeSH), each mention is grounded verbatim to the input (ungroundable ones dropped), and " +
    "abbreviations are resolved (Schwartz-Hearst). The normalized ids and scores are NOT LLM numbers. " +
    "USE WHEN you need the normalized entities in a text — e.g. to feed knowledge_graph or kg_link_predict, or " +
    "to canonicalize the genes/diseases/drugs a passage mentions.",
  annotations: READ_ONLY,
  inputSchema: {
    text: z
      .string()
      .min(3)
      .max(20000)
      .describe("The source text to recognize entities in (3-20000 chars)."),
  },
  handler: async (args, client): Promise<string> => {
    const schema = z.object({ text: z.string().min(3).max(20000) });
    try {
      const body = schema.parse(args);
      const data = await client.post<EntitiesResult>("/api/entities", body);
      const summary = `Recognized ${data.entities?.length ?? 0} entity(ies), ${
        data.linkedCount ?? 0
      } linked${
        data.groundingDroppedCount
          ? ` (${data.groundingDroppedCount} ungrounded dropped)`
          : ""
      }.`;
      return formatResult(summary, data);
    } catch (err) {
      return toErrorMessage(err);
    }
  },
});

interface EntitiesResult {
  entities?: unknown[];
  linkedCount?: number;
  groundingDroppedCount?: number;
}

// -----------------------------------------------------------------------------
// hybrid_retrieval — POST /api/retrieval/hybrid  { query, limit?, expandGraph? }
// -----------------------------------------------------------------------------

const hybridRetrieval = tool({
  name: "hybrid_retrieval",
  title: "Hybrid Source Retrieval",
  description:
    "Search PaperTrail's cached sources with hybrid retrieval — vector + full-text fused by Reciprocal Rank " +
    "Fusion, with optional graph expansion (native R2R hybrid_search port). Returns the best-first source hits " +
    "with their RRF provenance (which ranks fed each score) and a short snippet per hit. " +
    "USE WHEN you want to find the most relevant cached sources for a query before doing deeper work (QA, " +
    "extraction, synthesis), or to see what PaperTrail has cached on a subject. This is a fast retrieval index, " +
    "not an LLM analysis.",
  annotations: READ_ONLY,
  inputSchema: {
    query: z
      .string()
      .min(1)
      .max(1000)
      .describe("The search query (1-1000 chars)."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(50)
      .optional()
      .describe("Max hits to return (1-50)."),
    expandGraph: z
      .boolean()
      .optional()
      .describe("Expand results via knowledge-graph neighbors."),
  },
  handler: async (args, client): Promise<string> => {
    const schema = z.object({
      query: z.string().min(1).max(1000),
      limit: z.number().int().min(1).max(50).optional(),
      expandGraph: z.boolean().optional(),
    });
    try {
      const body = schema.parse(args);
      const data = await client.post<HybridResult>(
        "/api/retrieval/hybrid",
        body
      );
      const summary = `Retrieved ${data.results?.length ?? 0} source hit(s) via ${
        data.fusion?.method ?? "reciprocal_rank_fusion"
      }.`;
      return formatResult(summary, data);
    } catch (err) {
      return toErrorMessage(err);
    }
  },
});

interface HybridResult {
  results?: unknown[];
  fusion?: { method?: string };
}

// -----------------------------------------------------------------------------
// evidence_dossier — POST /api/dossier  { subjectType, subject, disease? }
// -----------------------------------------------------------------------------

const evidenceDossier = tool({
  name: "evidence_dossier",
  title: "Evidence Dossier Orchestrator",
  description:
    "Assemble a complete, verified, cited, trust-scored evidence dossier for a target, drug, disease, or claim " +
    "— PaperTrail's flagship. It composes the deterministic bio/evidence engines (genetic validation, " +
    "tractability, existing drugs, clinical trials, safety, mechanism, target-disease, claim verification); " +
    "Claude only PLANS which checks apply and NARRATES over the already-verified sections. Every load-bearing " +
    "number and the overall score/grade are DETERMINISTIC. " +
    "USE WHEN you want a one-shot, board-ready evidence package on an entity or claim (e.g. subjectType 'target', " +
    "subject 'PCSK9', disease 'hypercholesterolemia'). Runs many engines, so expect a wait; sections whose data " +
    "is unavailable are honestly omitted rather than faked.",
  annotations: READ_ONLY,
  inputSchema: {
    subjectType: z
      .enum(SUBJECT_TYPES)
      .describe("What the subject is: target, drug, disease, or claim."),
    subject: z
      .string()
      .min(1)
      .max(500)
      .describe("The primary entity or claim text (1-500 chars)."),
    disease: z
      .string()
      .min(1)
      .max(300)
      .optional()
      .describe(
        "Optional disease context for association/efficacy checks (e.g. 'hypercholesterolemia')."
      ),
  },
  handler: async (args, client): Promise<string> => {
    const schema = z.object({
      subjectType: z.enum(SUBJECT_TYPES),
      subject: z.string().min(1).max(500),
      disease: z.string().min(1).max(300).optional(),
    });
    try {
      const body = schema.parse(args);
      const data = await client.post<DossierResult>("/api/dossier", body);
      const summary = `Dossier for ${body.subjectType} '${body.subject}': ${
        data.sections?.length ?? 0
      } section(s), overall grade ${data.overallGrade ?? "n/a"} (score ${
        data.overallScore ?? "n/a"
      }).`;
      return formatResult(summary, data);
    } catch (err) {
      return toErrorMessage(err);
    }
  },
});

interface DossierResult {
  sections?: unknown[];
  overallGrade?: string;
  overallScore?: number;
}

// -----------------------------------------------------------------------------
// real_world_evidence — POST /api/rwe  { drug?, topic?, event? }
// -----------------------------------------------------------------------------

const realWorldEvidence = tool({
  name: "real_world_evidence",
  title: "Real-World-Evidence Temporal Signals",
  description:
    "Compute deterministic real-world-evidence (RWE) temporal signals over the open corpus (FAERS, PubMed, " +
    "ClinicalTrials.gov) — the 'Aetion angle' on public data. Provide 'drug'+'event' for a per-year FAERS " +
    "disproportionality trend (PRR/IC, classified rising/stable/falling by a deterministic OLS slope), and/or " +
    "'topic' for a per-year publication + trial-start volume trend (classified emerging/active/established). " +
    "EVERY number is computed by a deterministic engine; NO LLM is in the numeric path, and unavailable signals " +
    "come back null (honest-empty), never fabricated. " +
    "USE WHEN you want to see how a safety signal or a research area is trending over time. At least 'topic', " +
    "or both 'drug' and 'event', are required.",
  annotations: READ_ONLY,
  inputSchema: {
    drug: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe("Drug name for a FAERS adverse-event trend (needs 'event' too)."),
    topic: z
      .string()
      .min(1)
      .max(300)
      .optional()
      .describe("Topic for a publication + trial-start volume trend."),
    event: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe("Adverse event for the FAERS trend (needs 'drug' too)."),
  },
  handler: async (args, client): Promise<string> => {
    const schema = z
      .object({
        drug: z.string().min(1).max(200).optional(),
        topic: z.string().min(1).max(300).optional(),
        event: z.string().min(1).max(200).optional(),
      })
      .refine(
        (v) => Boolean(v.topic) || (Boolean(v.drug) && Boolean(v.event)),
        {
          message:
            "Provide 'topic', and/or both 'drug' and 'event'.",
        }
      );
    try {
      const body = schema.parse(args);
      const data = await client.post<RweResult>("/api/rwe", body);
      const parts: string[] = [];
      if (data.adverseEventTrend) {
        parts.push(`AE trend: ${data.adverseEventTrend.direction ?? "n/a"}`);
      }
      if (data.evidenceVolumeTrend) {
        parts.push(
          `evidence volume: ${data.evidenceVolumeTrend.maturity ?? "n/a"}`
        );
      }
      const summary = parts.length
        ? `RWE signals — ${parts.join("; ")}.`
        : "No RWE signals available for these inputs.";
      return formatResult(summary, data);
    } catch (err) {
      return toErrorMessage(err);
    }
  },
});

interface RweResult {
  adverseEventTrend?: { direction?: string } | null;
  evidenceVolumeTrend?: { maturity?: string } | null;
}

// -----------------------------------------------------------------------------
// Exported array — server.ts registers each of these.
// -----------------------------------------------------------------------------

export const researchTools: PaperTrailTool[] = [
  paperQa,
  deepResearch,
  researchBrief,
  researchGapsHypotheses,
  extractPaper,
  assembleMechanism,
  synthesisReport,
  knowledgeGraph,
  kgLinkPredict,
  extractEntities,
  hybridRetrieval,
  evidenceDossier,
  realWorldEvidence,
];
