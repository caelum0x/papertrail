export const meta = {
  name: 'wire-engines',
  description: 'Wire the 6 digested OSS engines (paper-qa, STORM, ASReview, MiniCheck, PyMARE, pyalex) beneath their PaperTrail features — engine-first with graceful TS+Claude fallback, all opt-in so default behavior and tests are unchanged.',
  whenToUse: 'After digest-oss: make the digested engines the real backends behind Paper QA, synthesis, screening, ingestion, meta-analysis cross-check, and fact-checking.',
  phases: [
    { title: 'Wire', detail: 'parallel disjoint: each engine into its target feature with fallback' },
    { title: 'Verify', detail: 'authoritative tsc + full vitest' },
    { title: 'Report', detail: 'what was wired + residual' },
  ],
}

const CTX = `PaperTrail digested 6 OSS engines as opt-in subprocess backends (bridges in lib/engines/*,
each exporting an is<Engine>Enabled() gate + an async call that REJECTS on any failure so callers
fall back). Wire each beneath its existing feature: try the engine when enabled, and on ANY rejection
fall back to the existing TS+Claude path. Engines are OFF by default (env flags), so the default code
path — and every existing test — MUST be byte-for-byte unchanged in behavior. Preserve each feature's
response contract exactly. Keep the deterministic trust layer: ground/verify engine outputs the same
way the TS path does (e.g. lib/grounding.ts for spans). Never log claim/question/abstract text. Small,
surgical edits. Read both the target file AND the bridge before editing.`

const RESULT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['engine', 'filesEdited', 'contractPreserved', 'fallbackOnReject', 'summary'],
  properties: {
    engine: { type: 'string' }, filesEdited: { type: 'array', items: { type: 'string' } },
    contractPreserved: { type: 'boolean' }, fallbackOnReject: { type: 'boolean' },
    summary: { type: 'string' }, notes: { type: 'string' },
  },
}
const VERIFY_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['tscPass', 'testsPass', 'testTotals', 'filesEdited', 'notes'],
  properties: {
    tscPass: { type: 'boolean' }, testsPass: { type: 'boolean' }, testTotals: { type: 'string' },
    filesEdited: { type: 'array', items: { type: 'string' } }, notes: { type: 'string' },
  },
}

const WIRES = [
  {
    key: 'paperqa', label: 'wire:paperqa',
    prompt: `Wire lib/engines/paperqa.ts (askPaperQa / isPaperQaEnabled) into lib/paperqa/ask.ts. Own ONLY
lib/paperqa/ask.ts. Read both files. When isPaperQaEnabled(): after retrieving candidate sources, call
askPaperQa({ question, texts:[{name,text}] } from the retrieved sources); GROUND its returned contexts
with lib/grounding.ts exactly as the TS path grounds snippets (drop ungroundable ones); map the engine's
{answer, contexts, references} into the SAME response shape ask.ts already returns (per-claim citations
grounded to source spans). On ANY rejection from askPaperQa, fall back to the existing TS+Claude pipeline
unchanged. Do not change the exported function signature or the disabled-path behavior.`,
  },
  {
    key: 'storm', label: 'wire:storm',
    prompt: `Wire lib/engines/storm.ts (generateStormArticle / isStormEnabled) into lib/synthesisReport/generate.ts.
Own ONLY lib/synthesisReport/generate.ts. Read both. When isStormEnabled(): after the evidence pipeline
produces the verified pooled evidence + sources, call generateStormArticle({ topic, sources }) using those
sources; map STORM's {outline, article, citations} into the SAME multi-section report contract generate.ts
returns, and CRITICALLY keep the engine's pooled NUMBERS (from the deterministic pipeline) authoritative —
STORM writes prose, the engine supplies every number. On any rejection, fall back to the existing TS+Claude
drafting unchanged. Preserve the response shape and disabled-path behavior.`,
  },
  {
    key: 'asreview', label: 'wire:asreview',
    prompt: `Wire lib/engines/asreview.ts (rankRecords / isAsreviewEnabled) into the AI screening ranker
lib/screening/aiRank.ts. Own ONLY lib/screening/aiRank.ts. Read both. When isAsreviewEnabled() AND there is
labeled training data (prior include/exclude decisions), call rankRecords({records, labeled}) and map its
{ranking:[{id,relevance}]} into the SAME ranking response aiRank.ts returns. On any rejection, or when there
is no labeled data to train on, fall back to the existing Claude relevance ranking unchanged. Preserve the
contract and disabled-path behavior.`,
  },
  {
    key: 'openalex', label: 'wire:openalex',
    prompt: `Wire lib/engines/openalex.ts (searchOpenAlex / isOpenAlexEnabled) into lib/ingest/searchAndCache.ts
as an ADDITIONAL source provider alongside PubMed + ClinicalTrials.gov. Own ONLY lib/ingest/searchAndCache.ts.
Read both. When isOpenAlexEnabled(): also fetch OpenAlex works for the query via searchOpenAlex, normalize
them into the SAME cached-source row shape (source_type 'openalex' or 'pubmed'-compatible; map openalex_id ->
external_id, reconstructed abstract -> raw_text, doi/title/url), and cache them with the SAME dedupe-by
(source_type, external_id) + upsert path used for the other providers (respect the never-re-fetch caching
rule). On any rejection, silently skip OpenAlex (the existing providers still work). Preserve the return
shape { cachedSourceIds, fetchedCount, reusedCount } and disabled-path behavior. If 'openalex' needs to be an
allowed source_type in a Zod/enum somewhere you own here, add it; otherwise map to an existing accepted type.`,
  },
  {
    key: 'pymare', label: 'wire:pymare-crosscheck',
    prompt: `Add a PyMARE cross-check as NEW files (do NOT edit lib/metaAnalysis.ts). Own ONLY:
lib/engines/metaCrossCheck.ts and app/api/meta-crosscheck/route.ts. Read lib/engines/pymare.ts and
lib/metaAnalysis.ts. metaCrossCheck.ts exports crossCheckMeta(studies): run our TS metaAnalyze AND (when
isPymareEnabled()) pooledPyMARE on the same yi/vi, and return { ours, reference, agree:boolean, maxAbsDiff }
comparing the random-effects estimate — a production oracle proving our TS engine matches the reference
implementation. When PyMARE is disabled/rejects, return { ours, reference:null, agree:null }. app/api/
meta-crosscheck/route.ts: public POST, rate-limited, envelope, Zod-validated. Do not break anything else.`,
  },
  {
    key: 'minicheck', label: 'wire:minicheck-factcheck',
    prompt: `Add MiniCheck as a supplementary entailment fact-check via NEW files (do NOT edit reserved
engines). Own ONLY: lib/engines/factCheck.ts and app/api/fact-check/route.ts. Read lib/engines/minicheck.ts.
factCheck.ts exports checkClaimsSupported(pairs:[{claim, doc}]) -> when isMinicheckEnabled(), call the
minicheck bridge and return {results:[{claim, supported, score}]}; on reject/disabled return null (caller
treats absence as 'not checked'). This complements lib/grounding.ts (verbatim spans) with entailment. app/
api/fact-check/route.ts: public POST, rate-limited, envelope, Zod-validated, sanitize inputs, never log text.`,
  },
]

// PHASE 1 — WIRE (parallel, disjoint files)
phase('Wire')
log('Wiring 6 digested engines beneath their features (engine-first, graceful fallback)…')
const wired = await parallel(
  WIRES.map((w) => () =>
    agent(CTX + '\n\n' + w.prompt, { label: w.label, phase: 'Wire', schema: RESULT_SCHEMA, effort: 'high' })
      .then((r) => ({ key: w.key, r }))
  )
)
const done = wired.filter(Boolean)
log('Wired ' + done.filter((d) => d.r?.contractPreserved && d.r?.fallbackOnReject).length + '/' + done.length + ' engines with contract + fallback preserved.')

// PHASE 2 — VERIFY (authoritative)
phase('Verify')
log('Authoritative tsc + full vitest…')
const verify = await agent(
  CTX + `

AUTHORITATIVELY VERIFY after the wiring. Run: npx tsc --noEmit, then npx vitest run. Report tscPass,
testsPass (with testTotals), and every file edited. If RED, fix minimally — the engines are OFF by default
so every existing test MUST still pass; a red test means a wiring changed the default path (fix the wiring,
not the test). Do not weaken tests. Be honest about any residual red.`,
  { label: 'verify:authoritative', phase: 'Verify', schema: VERIFY_SCHEMA, effort: 'high' }
)

// PHASE 3 — REPORT
phase('Report')
return {
  wired: done.map((d) => ({ engine: d.key, files: d.r?.filesEdited || [], contractPreserved: d.r?.contractPreserved ?? null,
    fallbackOnReject: d.r?.fallbackOnReject ?? null, summary: d.r?.summary || '' })),
  verify,
}
