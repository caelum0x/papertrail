export const meta = {
  name: 'uploads-and-polish',
  description: 'Multi-format document upload (PDF/DOCX/XLSX/CSV/MD/TXT/PPTX) with a drag-and-drop uploader, plus a website polish pass using the new PaperTrail logo/branding.',
  whenToUse: 'Let users upload any common document format and improve the marketing + console UI.',
  phases: [
    { title: 'Build', detail: 'parallel disjoint: multi-format extraction+upload, drag-drop UI, website polish' },
    { title: 'Verify', detail: 'tsc + tests + build' },
    { title: 'Report', detail: 'what changed' },
  ],
}

const CTX = `PaperTrail — Next.js 16 (App Router, TS strict) + Postgres/pgvector + Anthropic Claude. House
Tailwind tokens: bg-paper, text-ink, accent, border-ink/15; reuse components/console/StateBanners and the
app/console/claims page loading/error/empty pattern. Logo is at /public/logo.png (a checkmarked document +
winding trail, navy + blue). Org-scoped routes use withOrg + requireRole + writeAudit, org_id first predicate,
never trust client org_id. Public envelope via lib/api/response (ok/created/fail). Deps already installed:
mammoth (DOCX -> text/html) and xlsx (SheetJS, XLSX/CSV -> sheets). PDF extraction already exists
(lib/ingestion/extractDocument via unpdf/Docling). Each vertical owns ONLY its listed files (disjoint).`

const BUILD_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['area', 'filesWritten', 'summary'],
  properties: {
    area: { type: 'string' }, filesWritten: { type: 'array', items: { type: 'string' } }, summary: { type: 'string' },
    notes: { type: 'string' },
  },
}
const VERIFY_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['tscPass', 'testsPass', 'buildPass', 'testTotals', 'filesEdited', 'notes'],
  properties: {
    tscPass: { type: 'boolean' }, testsPass: { type: 'boolean' }, buildPass: { type: 'boolean' },
    testTotals: { type: 'string' }, filesEdited: { type: 'array', items: { type: 'string' } }, notes: { type: 'string' },
  },
}

const AREAS = [
  {
    key: 'extraction', label: 'uploads:multi-format-extraction',
    prompt: CTX + `

BUILD MULTI-FORMAT DOCUMENT EXTRACTION so users can upload ANY common format. Own ONLY:
lib/ingestion/officeExtract.ts, lib/ingestion/extractAny.ts, tests/extractAny.test.ts, and EDIT
app/api/documents/upload/route.ts to use it.
- lib/ingestion/officeExtract.ts: extractDocx(bytes) via mammoth (mammoth.extractRawText({buffer}) -> text);
  extractSpreadsheet(bytes) via xlsx (XLSX.read(bytes,{type:'buffer'}) -> for each sheet XLSX.utils.
  sheet_to_csv -> a readable text dump with sheet headers); extractCsv/extractText/extractMarkdown as UTF-8
  text (markdown returned as-is; strip nothing). All pure async, return { text, meta? }; throw a clear error
  on a corrupt file.
- lib/ingestion/extractAny.ts: extractAnyDocument({ bytes, filename, mimeType }) that ROUTES by mime/extension
  to the right extractor — pdf -> existing extractDocument (import it), docx -> extractDocx, xlsx/xls ->
  extractSpreadsheet, csv -> extractCsv, md/markdown -> extractMarkdown, txt/plain -> extractText — returns
  { text, format, engine }. Unknown/binary -> honest error. Document the accepted formats as an exported
  ACCEPTED_UPLOAD_FORMATS list ({ ext, mime, label }).
- Wire app/api/documents/upload/route.ts: accept the broader mime types + extensions, decode base64, call
  extractAnyDocument, store the extracted text as today. Keep the existing text + PDF paths working; keep it
  org-scoped; never log file content.
tests: over small in-memory fixtures assert routing + that a CSV/markdown/txt round-trips to text, and a
docx/xlsx path is dispatched to the right extractor (mock mammoth/xlsx or use a tiny real buffer). Keep tests
offline.`,
  },
  {
    key: 'uploader', label: 'uploads:drag-drop-ui',
    prompt: CTX + `

BUILD a DRAG-AND-DROP multi-file uploader for the documents module. Own ONLY:
app/console/documents/_components/Uploader.tsx and app/console/documents/upload/page.tsx (create the page;
if app/console/documents/import already exists, do NOT edit it — this is a new dedicated upload page). Read
app/console/documents/page.tsx + _components for the house patterns and the existing upload API contract
(app/api/documents/upload).
- Uploader.tsx ('use client'): a drop zone (dashed border-ink/15, accent on drag-over) + a file picker
  accepting .pdf,.docx,.xlsx,.xls,.csv,.md,.txt (and a hint listing them). On drop/select, for EACH file read
  it as base64 (FileReader), POST to /api/documents/upload with { filename, mime_type, content_base64 },
  show a per-file row with a format badge + status (queued/uploading/done/error) + a progress state, and a
  final summary. Handle large-file guardrails (e.g. warn/skip > ~15MB). Send x-org-id from localStorage
  pt_active_org. Reuse StateBanners for errors. Accessible (labelled input, keyboard).
- upload/page.tsx: a page with a ModuleHeader ('Upload documents' + subtitle listing supported formats) that
  renders Uploader and links back to the documents list.
No new API (reuse /api/documents/upload). Keep files <300 lines.`,
  },
  {
    key: 'website', label: 'uploads:website-polish',
    prompt: CTX + `

POLISH THE MARKETING WEBSITE + branding with the new logo. Own ONLY: app/page.tsx (the marketing landing) and
app/_components/* (create small components under app/_components if helpful; do NOT edit app/console or
components/NavBar which are handled elsewhere). READ app/page.tsx first to preserve its sections/content.
Improve: a stronger hero using the logo (/public/logo.png via next/image) + a crisp one-line value prop
("Claude reads the literature; a deterministic engine proves every number") + primary CTA to /register and a
secondary to the live console; a clean feature grid highlighting the real capabilities (claim verification,
evidence synthesis/meta-analysis, biomedical evidence — genetics/safety/targets, research copilot, systematic
review, provenance/audit); consistent house Tailwind styling; responsive; accessible. Keep it truthful to
what exists. Do NOT add heavy dependencies. Keep it fast (no huge images beyond the logo).`,
  },
]

phase('Build')
log('Building multi-format upload, drag-drop UI, and website polish…')
const built = await parallel(
  AREAS.map((a) => () => agent(a.prompt, { label: a.label, phase: 'Build', schema: BUILD_SCHEMA, effort: 'high' }).then((r) => ({ key: a.key, r })))
)
const done = built.filter(Boolean)
log('Built ' + done.length + ' areas.')

phase('Verify')
const verify = await agent(
  CTX + `

AUTHORITATIVELY VERIFY after this round. Run npx tsc --noEmit (backend/ and reference are excluded), then
npx vitest run, then npm run build. Report tscPass, testsPass (with totals), buildPass, files edited. If RED,
fix minimally (fix wrong CODE, not correct tests). Be honest about residual red.`,
  { label: 'verify:uploads', phase: 'Verify', schema: VERIFY_SCHEMA, effort: 'high' }
)

phase('Report')
return {
  areas: done.map((d) => ({ area: d.key, files: d.r?.filesWritten || [], summary: d.r?.summary || '' })),
  verify,
}
