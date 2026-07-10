// CURATED ontology + marker starter seed for PaperTrail's deterministic entity-linking
// layer (lib/entities/canonicalize.ts) and immune-cell reasoning.
//
// WHY curated, not a dump: the full HGNC / EFO / MONDO / ChEMBL / CellMarker2.0 sources are
// multi-GB and we cannot ship them into the demo. Instead we hand-curate a HONEST, well-
// provenanced subset covering the genes / diseases / drugs / immune populations the product
// actually exercises. Every marker row carries its source database + pmid; every term its
// canonical label and cross-references. Coverage is logged at ingest time
// (scripts/ingest-ontology.ts) so the gap is visible, never hidden.
//
// NO LLM produced any identifier, synonym, or marker here — these are literature/database
// values transcribed by hand, which is exactly the moat: reproducible, auditable identity.
//
// All ids are real CURIEs. xrefs use NCBIGene: / ensembl: namespaces. Marker directions are
// 'positive' | 'negative'. Synonyms are stored VERBATIM and normalized at ingest time (the
// canonicalizer lower-cases + collapses whitespace), so casing here is human-readable.

// ---------------------------------------------------------------------------
// Types — the exported shape each seed array conforms to. These mirror the 0062 schema.
// ---------------------------------------------------------------------------

export type TermType =
  | "gene"
  | "disease"
  | "drug"
  | "cell_type"
  | "tissue";

export interface OntologyTermSeed {
  curie: string;
  ontology: string;
  label: string;
  termType: TermType;
  /** Human-readable surface forms; normalized (lowercased, ws-collapsed) at ingest. */
  synonyms: string[];
  /** Equivalent ids in other namespaces (e.g. "NCBIGene:3575"). */
  xrefs: string[];
  obsolete?: boolean;
  replacedBy?: string | null;
}

export type MarkerDirection = "positive" | "negative";

export interface CellMarkerSeed {
  cellTypeCurie: string | null;
  cellTypeLabel: string;
  geneCurie: string | null;
  geneSymbol: string;
  direction: MarkerDirection;
  tissueCurie: string | null;
  source: string;
  pmid: string;
}

export interface GeneSignatureSeed {
  signatureId: string;
  name: string;
  source: string;
  geneSymbols: string[];
  provenance: string;
}

// ---------------------------------------------------------------------------
// GENES (HGNC). label = HGNC symbol; synonyms include symbol + common name + aliases.
// xrefs carry the NCBI Gene id and Ensembl gene id. These are the recurring markers /
// targets across the immune / oncology claims the demo handles.
// ---------------------------------------------------------------------------

const GENE_TERMS: OntologyTermSeed[] = [
  {
    curie: "HGNC:6024",
    ontology: "HGNC",
    label: "IL7R",
    termType: "gene",
    synonyms: ["IL7R", "interleukin 7 receptor", "CD127", "IL-7R", "IL7 receptor alpha"],
    xrefs: ["NCBIGene:3575", "ensembl:ENSG00000168685"],
  },
  {
    curie: "HGNC:11639",
    ontology: "HGNC",
    label: "TCF7",
    termType: "gene",
    synonyms: ["TCF7", "transcription factor 7", "TCF-1", "TCF1"],
    xrefs: ["NCBIGene:6932", "ensembl:ENSG00000081059"],
  },
  {
    curie: "HGNC:1606",
    ontology: "HGNC",
    label: "CCR7",
    termType: "gene",
    synonyms: ["CCR7", "C-C motif chemokine receptor 7", "CD197", "EBI1"],
    xrefs: ["NCBIGene:1236", "ensembl:ENSG00000126353"],
  },
  {
    curie: "HGNC:10720",
    ontology: "HGNC",
    label: "SELL",
    termType: "gene",
    synonyms: ["SELL", "selectin L", "CD62L", "L-selectin"],
    xrefs: ["NCBIGene:6402", "ensembl:ENSG00000188404"],
  },
  {
    curie: "HGNC:6551",
    ontology: "HGNC",
    label: "LEF1",
    termType: "gene",
    synonyms: ["LEF1", "lymphoid enhancer binding factor 1", "TCF10", "LEF-1"],
    xrefs: ["NCBIGene:51176", "ensembl:ENSG00000138795"],
  },
  {
    curie: "HGNC:6106",
    ontology: "HGNC",
    label: "FOXP3",
    termType: "gene",
    synonyms: ["FOXP3", "forkhead box P3", "scurfin", "IPEX", "AIID"],
    xrefs: ["NCBIGene:50943", "ensembl:ENSG00000049768"],
  },
  {
    curie: "HGNC:8760",
    ontology: "HGNC",
    label: "PDCD1",
    termType: "gene",
    synonyms: ["PDCD1", "programmed cell death 1", "PD-1", "PD1", "CD279"],
    xrefs: ["NCBIGene:5133", "ensembl:ENSG00000188389"],
  },
  {
    curie: "HGNC:18437",
    ontology: "HGNC",
    label: "HAVCR2",
    termType: "gene",
    synonyms: ["HAVCR2", "hepatitis A virus cellular receptor 2", "TIM-3", "TIM3", "CD366"],
    xrefs: ["NCBIGene:84868", "ensembl:ENSG00000135077"],
  },
  {
    curie: "HGNC:6476",
    ontology: "HGNC",
    label: "LAG3",
    termType: "gene",
    synonyms: ["LAG3", "lymphocyte activating 3", "LAG-3", "CD223"],
    xrefs: ["NCBIGene:3902", "ensembl:ENSG00000089692"],
  },
  {
    curie: "HGNC:11605",
    ontology: "HGNC",
    label: "TIGIT",
    termType: "gene",
    synonyms: [
      "TIGIT",
      "T cell immunoreceptor with Ig and ITIM domains",
      "VSTM3",
      "WUCAM",
    ],
    xrefs: ["NCBIGene:201633", "ensembl:ENSG00000181847"],
  },
  {
    curie: "HGNC:11973",
    ontology: "HGNC",
    label: "TOX",
    termType: "gene",
    synonyms: ["TOX", "thymocyte selection associated high mobility group box"],
    xrefs: ["NCBIGene:9760", "ensembl:ENSG00000198846"],
  },
  {
    curie: "HGNC:7107",
    ontology: "HGNC",
    label: "MKI67",
    termType: "gene",
    synonyms: ["MKI67", "marker of proliferation Ki-67", "Ki-67", "Ki67", "KIA"],
    xrefs: ["NCBIGene:4288", "ensembl:ENSG00000148773"],
  },
  {
    curie: "HGNC:7830",
    ontology: "HGNC",
    label: "NKG7",
    termType: "gene",
    synonyms: ["NKG7", "natural killer cell granule protein 7", "GMP-17", "p15-TIA-1"],
    xrefs: ["NCBIGene:4818", "ensembl:ENSG00000105374"],
  },
  {
    curie: "HGNC:1628",
    ontology: "HGNC",
    label: "CD14",
    termType: "gene",
    synonyms: ["CD14", "CD14 molecule", "CD14 antigen"],
    xrefs: ["NCBIGene:929", "ensembl:ENSG00000170458"],
  },
  {
    curie: "HGNC:7315",
    ontology: "HGNC",
    label: "MS4A1",
    termType: "gene",
    synonyms: [
      "MS4A1",
      "membrane spanning 4-domains A1",
      "CD20",
      "B1",
      "Bp35",
    ],
    xrefs: ["NCBIGene:931", "ensembl:ENSG00000156738"],
  },
  {
    curie: "HGNC:11892",
    ontology: "HGNC",
    label: "TNF",
    termType: "gene",
    synonyms: ["TNF", "tumor necrosis factor", "TNF-alpha", "TNFA", "TNFSF2", "cachectin"],
    xrefs: ["NCBIGene:7124", "ensembl:ENSG00000232810"],
  },
  {
    curie: "HGNC:6192",
    ontology: "HGNC",
    label: "JAK2",
    termType: "gene",
    synonyms: ["JAK2", "Janus kinase 2", "JTK10"],
    xrefs: ["NCBIGene:3717", "ensembl:ENSG00000096968"],
  },
  {
    curie: "HGNC:1679",
    ontology: "HGNC",
    label: "CD8A",
    termType: "gene",
    synonyms: ["CD8A", "CD8a molecule", "CD8", "CD8 alpha", "Leu2", "MAL"],
    xrefs: ["NCBIGene:925", "ensembl:ENSG00000153563"],
  },
  {
    curie: "HGNC:1747",
    ontology: "HGNC",
    label: "CD4",
    termType: "gene",
    synonyms: ["CD4", "CD4 molecule", "CD4 antigen", "Leu3", "T4"],
    xrefs: ["NCBIGene:920", "ensembl:ENSG00000010610"],
  },
  {
    curie: "HGNC:2334",
    ontology: "HGNC",
    label: "CD3D",
    termType: "gene",
    synonyms: ["CD3D", "CD3 delta subunit", "CD3", "T3D"],
    xrefs: ["NCBIGene:915", "ensembl:ENSG00000167286"],
  },
  {
    curie: "HGNC:2694",
    ontology: "HGNC",
    label: "GZMB",
    termType: "gene",
    synonyms: ["GZMB", "granzyme B", "CTLA1", "CSPB", "granzyme-B"],
    xrefs: ["NCBIGene:3002", "ensembl:ENSG00000100453"],
  },
  {
    curie: "HGNC:6778",
    ontology: "HGNC",
    label: "MS4A7",
    termType: "gene",
    synonyms: ["MS4A7", "membrane spanning 4-domains A7", "CFFM4"],
    xrefs: ["NCBIGene:58475", "ensembl:ENSG00000166927"],
  },
  {
    curie: "HGNC:1671",
    ontology: "HGNC",
    label: "CD68",
    termType: "gene",
    synonyms: ["CD68", "CD68 molecule", "macrosialin", "GP110", "SCARD1"],
    xrefs: ["NCBIGene:968", "ensembl:ENSG00000129226"],
  },
  {
    curie: "HGNC:7059",
    ontology: "HGNC",
    label: "NCAM1",
    termType: "gene",
    synonyms: ["NCAM1", "neural cell adhesion molecule 1", "CD56", "NCAM"],
    xrefs: ["NCBIGene:4684", "ensembl:ENSG00000149294"],
  },
  {
    curie: "HGNC:3499",
    ontology: "HGNC",
    label: "FCGR3A",
    termType: "gene",
    synonyms: ["FCGR3A", "Fc gamma receptor IIIa", "CD16", "CD16a", "FCGR3", "FCG3"],
    xrefs: ["NCBIGene:2214", "ensembl:ENSG00000203747"],
  },
  {
    curie: "HGNC:9437",
    ontology: "HGNC",
    label: "IL3RA",
    termType: "gene",
    synonyms: ["IL3RA", "interleukin 3 receptor subunit alpha", "CD123", "IL3R"],
    xrefs: ["NCBIGene:3563", "ensembl:ENSG00000185291"],
  },
  {
    curie: "HGNC:2451",
    ontology: "HGNC",
    label: "CLEC4C",
    termType: "gene",
    synonyms: ["CLEC4C", "C-type lectin domain family 4 member C", "BDCA2", "CD303", "DLEC"],
    xrefs: ["NCBIGene:170482", "ensembl:ENSG00000198178"],
  },
];

// ---------------------------------------------------------------------------
// DISEASES (EFO / MONDO). A small honest set covering the demo's disease claims.
// ---------------------------------------------------------------------------

const DISEASE_TERMS: OntologyTermSeed[] = [
  {
    curie: "EFO:0000756",
    ontology: "EFO",
    label: "melanoma",
    termType: "disease",
    synonyms: ["melanoma", "malignant melanoma", "cutaneous melanoma"],
    xrefs: ["MONDO:0005105", "MeSH:D008545"],
  },
  {
    curie: "EFO:0000685",
    ontology: "EFO",
    label: "rheumatoid arthritis",
    termType: "disease",
    synonyms: ["rheumatoid arthritis", "RA"],
    xrefs: ["MONDO:0008383", "MeSH:D001172"],
  },
];

// ---------------------------------------------------------------------------
// DRUGS (ChEMBL). Immune-checkpoint + relevant biologics/small molecules.
// ---------------------------------------------------------------------------

const DRUG_TERMS: OntologyTermSeed[] = [
  {
    curie: "ChEMBL:CHEMBL3137343",
    ontology: "ChEMBL",
    label: "pembrolizumab",
    termType: "drug",
    synonyms: ["pembrolizumab", "keytruda", "MK-3475", "lambrolizumab"],
    xrefs: ["MeSH:D000077594"],
  },
  {
    curie: "ChEMBL:CHEMBL2108738",
    ontology: "ChEMBL",
    label: "nivolumab",
    termType: "drug",
    synonyms: ["nivolumab", "opdivo", "BMS-936558", "MDX-1106"],
    xrefs: ["MeSH:D000077594"],
  },
  {
    curie: "ChEMBL:CHEMBL1201585",
    ontology: "ChEMBL",
    label: "rituximab",
    termType: "drug",
    synonyms: ["rituximab", "rituxan", "mabthera", "IDEC-C2B8"],
    xrefs: ["MeSH:D000069283"],
  },
  {
    curie: "ChEMBL:CHEMBL1201580",
    ontology: "ChEMBL",
    label: "adalimumab",
    termType: "drug",
    synonyms: ["adalimumab", "humira", "D2E7"],
    xrefs: ["MeSH:D000068879"],
  },
  {
    curie: "ChEMBL:CHEMBL221959",
    ontology: "ChEMBL",
    label: "ruxolitinib",
    termType: "drug",
    synonyms: ["ruxolitinib", "jakafi", "jakavi", "INCB018424"],
    xrefs: ["MeSH:D000077310"],
  },
];

// ---------------------------------------------------------------------------
// Combined ontology-term seed. resolveEntity() indexes these by normalized synonym.
// ---------------------------------------------------------------------------

export const ONTOLOGY_TERMS: readonly OntologyTermSeed[] = [
  ...GENE_TERMS,
  ...DISEASE_TERMS,
  ...DRUG_TERMS,
];

// ---------------------------------------------------------------------------
// CELL MARKER PANELS — canonical immune populations with directional markers and
// full provenance (source database + pmid). Cell-type CURIEs use the Cell Ontology (CL)
// where a standard term exists; label is the working population name used in claims.
//
// pmids: CellMarker 2.0 (PMID 36300619), PanglaoDB (PMID 30951143).
// ---------------------------------------------------------------------------

const CELLMARKER_PMID = "36300619"; // CellMarker 2.0 (Hu et al., Nucleic Acids Res 2023)
const PANGLAO_PMID = "30951143"; // PanglaoDB (Franzén et al., Database 2019)

export const CELL_MARKER_PANELS: readonly CellMarkerSeed[] = [
  // CD8 memory-like T cell — TCF7/LEF1/CCR7/SELL/IL7R high; exhaustion markers absent.
  { cellTypeCurie: "CL:0000909", cellTypeLabel: "CD8 memory-like T cell", geneCurie: "HGNC:1679", geneSymbol: "CD8A", direction: "positive", tissueCurie: null, source: "CellMarker2.0", pmid: CELLMARKER_PMID },
  { cellTypeCurie: "CL:0000909", cellTypeLabel: "CD8 memory-like T cell", geneCurie: "HGNC:11639", geneSymbol: "TCF7", direction: "positive", tissueCurie: null, source: "CellMarker2.0", pmid: CELLMARKER_PMID },
  { cellTypeCurie: "CL:0000909", cellTypeLabel: "CD8 memory-like T cell", geneCurie: "HGNC:6551", geneSymbol: "LEF1", direction: "positive", tissueCurie: null, source: "CellMarker2.0", pmid: CELLMARKER_PMID },
  { cellTypeCurie: "CL:0000909", cellTypeLabel: "CD8 memory-like T cell", geneCurie: "HGNC:1606", geneSymbol: "CCR7", direction: "positive", tissueCurie: null, source: "CellMarker2.0", pmid: CELLMARKER_PMID },
  { cellTypeCurie: "CL:0000909", cellTypeLabel: "CD8 memory-like T cell", geneCurie: "HGNC:10720", geneSymbol: "SELL", direction: "positive", tissueCurie: null, source: "CellMarker2.0", pmid: CELLMARKER_PMID },
  { cellTypeCurie: "CL:0000909", cellTypeLabel: "CD8 memory-like T cell", geneCurie: "HGNC:6024", geneSymbol: "IL7R", direction: "positive", tissueCurie: null, source: "CellMarker2.0", pmid: CELLMARKER_PMID },
  { cellTypeCurie: "CL:0000909", cellTypeLabel: "CD8 memory-like T cell", geneCurie: "HGNC:8760", geneSymbol: "PDCD1", direction: "negative", tissueCurie: null, source: "CellMarker2.0", pmid: CELLMARKER_PMID },

  // CD8 exhausted / dysfunctional T cell — PDCD1/HAVCR2/LAG3/TIGIT/TOX/GZMB high; memory low.
  { cellTypeCurie: "CL:0000625", cellTypeLabel: "CD8 exhausted T cell", geneCurie: "HGNC:1679", geneSymbol: "CD8A", direction: "positive", tissueCurie: null, source: "CellMarker2.0", pmid: CELLMARKER_PMID },
  { cellTypeCurie: "CL:0000625", cellTypeLabel: "CD8 exhausted T cell", geneCurie: "HGNC:8760", geneSymbol: "PDCD1", direction: "positive", tissueCurie: null, source: "CellMarker2.0", pmid: CELLMARKER_PMID },
  { cellTypeCurie: "CL:0000625", cellTypeLabel: "CD8 exhausted T cell", geneCurie: "HGNC:18437", geneSymbol: "HAVCR2", direction: "positive", tissueCurie: null, source: "CellMarker2.0", pmid: CELLMARKER_PMID },
  { cellTypeCurie: "CL:0000625", cellTypeLabel: "CD8 exhausted T cell", geneCurie: "HGNC:6476", geneSymbol: "LAG3", direction: "positive", tissueCurie: null, source: "CellMarker2.0", pmid: CELLMARKER_PMID },
  { cellTypeCurie: "CL:0000625", cellTypeLabel: "CD8 exhausted T cell", geneCurie: "HGNC:11605", geneSymbol: "TIGIT", direction: "positive", tissueCurie: null, source: "CellMarker2.0", pmid: CELLMARKER_PMID },
  { cellTypeCurie: "CL:0000625", cellTypeLabel: "CD8 exhausted T cell", geneCurie: "HGNC:11973", geneSymbol: "TOX", direction: "positive", tissueCurie: null, source: "CellMarker2.0", pmid: CELLMARKER_PMID },
  { cellTypeCurie: "CL:0000625", cellTypeLabel: "CD8 exhausted T cell", geneCurie: "HGNC:2694", geneSymbol: "GZMB", direction: "positive", tissueCurie: null, source: "CellMarker2.0", pmid: CELLMARKER_PMID },
  { cellTypeCurie: "CL:0000625", cellTypeLabel: "CD8 exhausted T cell", geneCurie: "HGNC:11639", geneSymbol: "TCF7", direction: "negative", tissueCurie: null, source: "CellMarker2.0", pmid: CELLMARKER_PMID },

  // Regulatory T cell (Treg) — CD4/FOXP3 positive.
  { cellTypeCurie: "CL:0000815", cellTypeLabel: "regulatory T cell", geneCurie: "HGNC:1747", geneSymbol: "CD4", direction: "positive", tissueCurie: null, source: "CellMarker2.0", pmid: CELLMARKER_PMID },
  { cellTypeCurie: "CL:0000815", cellTypeLabel: "regulatory T cell", geneCurie: "HGNC:6106", geneSymbol: "FOXP3", direction: "positive", tissueCurie: null, source: "CellMarker2.0", pmid: CELLMARKER_PMID },
  { cellTypeCurie: "CL:0000815", cellTypeLabel: "regulatory T cell", geneCurie: "HGNC:9437", geneSymbol: "IL3RA", direction: "negative", tissueCurie: null, source: "CellMarker2.0", pmid: CELLMARKER_PMID },

  // B cell — MS4A1 (CD20) positive.
  { cellTypeCurie: "CL:0000236", cellTypeLabel: "B cell", geneCurie: "HGNC:7315", geneSymbol: "MS4A1", direction: "positive", tissueCurie: null, source: "PanglaoDB", pmid: PANGLAO_PMID },
  { cellTypeCurie: "CL:0000236", cellTypeLabel: "B cell", geneCurie: "HGNC:2334", geneSymbol: "CD3D", direction: "negative", tissueCurie: null, source: "PanglaoDB", pmid: PANGLAO_PMID },

  // NK cell — NCAM1 (CD56) / NKG7 / FCGR3A (CD16) positive; CD3 negative.
  { cellTypeCurie: "CL:0000623", cellTypeLabel: "natural killer cell", geneCurie: "HGNC:7059", geneSymbol: "NCAM1", direction: "positive", tissueCurie: null, source: "PanglaoDB", pmid: PANGLAO_PMID },
  { cellTypeCurie: "CL:0000623", cellTypeLabel: "natural killer cell", geneCurie: "HGNC:7830", geneSymbol: "NKG7", direction: "positive", tissueCurie: null, source: "PanglaoDB", pmid: PANGLAO_PMID },
  { cellTypeCurie: "CL:0000623", cellTypeLabel: "natural killer cell", geneCurie: "HGNC:3499", geneSymbol: "FCGR3A", direction: "positive", tissueCurie: null, source: "PanglaoDB", pmid: PANGLAO_PMID },
  { cellTypeCurie: "CL:0000623", cellTypeLabel: "natural killer cell", geneCurie: "HGNC:2334", geneSymbol: "CD3D", direction: "negative", tissueCurie: null, source: "PanglaoDB", pmid: PANGLAO_PMID },

  // Macrophage / Monocyte — CD14 / CD68 / MS4A7 positive.
  { cellTypeCurie: "CL:0000235", cellTypeLabel: "macrophage/monocyte", geneCurie: "HGNC:1628", geneSymbol: "CD14", direction: "positive", tissueCurie: null, source: "CellMarker2.0", pmid: CELLMARKER_PMID },
  { cellTypeCurie: "CL:0000235", cellTypeLabel: "macrophage/monocyte", geneCurie: "HGNC:1671", geneSymbol: "CD68", direction: "positive", tissueCurie: null, source: "CellMarker2.0", pmid: CELLMARKER_PMID },
  { cellTypeCurie: "CL:0000235", cellTypeLabel: "macrophage/monocyte", geneCurie: "HGNC:6778", geneSymbol: "MS4A7", direction: "positive", tissueCurie: null, source: "CellMarker2.0", pmid: CELLMARKER_PMID },

  // Plasmacytoid dendritic cell (pDC) — IL3RA (CD123) / CLEC4C (BDCA2) positive.
  { cellTypeCurie: "CL:0000784", cellTypeLabel: "plasmacytoid dendritic cell", geneCurie: "HGNC:9437", geneSymbol: "IL3RA", direction: "positive", tissueCurie: null, source: "CellMarker2.0", pmid: CELLMARKER_PMID },
  { cellTypeCurie: "CL:0000784", cellTypeLabel: "plasmacytoid dendritic cell", geneCurie: "HGNC:2451", geneSymbol: "CLEC4C", direction: "positive", tissueCurie: null, source: "CellMarker2.0", pmid: CELLMARKER_PMID },
];

// ---------------------------------------------------------------------------
// GENE SIGNATURES — named gene sets with provenance.
// ---------------------------------------------------------------------------

export const GENE_SIGNATURES: readonly GeneSignatureSeed[] = [
  {
    signatureId: "ICB_RESPONDER_MEMORY",
    name: "ICB responder memory-like CD8 signature",
    source: "curated",
    geneSymbols: ["TCF7", "LEF1", "CCR7", "SELL", "IL7R"],
    provenance:
      "Memory/stem-like CD8 program associated with response to immune-checkpoint blockade (TCF7+ stem-like T cells; Sade-Feldman et al. Cell 2018, PMID 30388456; Siddiqui et al. Immunity 2019, PMID 30635237).",
  },
  {
    signatureId: "CD8_EXHAUSTION",
    name: "CD8 T-cell exhaustion signature",
    source: "curated",
    geneSymbols: ["PDCD1", "HAVCR2", "LAG3", "TIGIT", "TOX"],
    provenance:
      "Core terminal-exhaustion / dysfunction program in tumor-infiltrating CD8 T cells (TOX-driven exhaustion; Khan et al. Nature 2019, PMID 31207603).",
  },
];

// ---------------------------------------------------------------------------
// ONTOLOGY EDGES — thin cell-type marker backbone (has_marker for positive markers).
// Derived deterministically from CELL_MARKER_PANELS at ingest time; exported here as a
// pure function so both the ingest script and any consumer produce the same edges.
// ---------------------------------------------------------------------------

export interface OntologyEdgeSeed {
  subjectCurie: string;
  predicate: string;
  objectCurie: string;
}

export function deriveOntologyEdges(
  panels: readonly CellMarkerSeed[] = CELL_MARKER_PANELS
): OntologyEdgeSeed[] {
  const seen = new Set<string>();
  const edges: OntologyEdgeSeed[] = [];
  for (const p of panels) {
    if (p.direction !== "positive") continue;
    if (!p.cellTypeCurie || !p.geneCurie) continue;
    const key = `${p.cellTypeCurie} has_marker ${p.geneCurie}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({
      subjectCurie: p.cellTypeCurie,
      predicate: "has_marker",
      objectCurie: p.geneCurie,
    });
  }
  return edges;
}

export const ONTOLOGY_EDGES: readonly OntologyEdgeSeed[] = deriveOntologyEdges();
