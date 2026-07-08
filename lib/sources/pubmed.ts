// PubMed E-utilities client. No API key required, but one raises the rate
// limit from 3/sec to 10/sec - set NCBI_API_KEY in production.
// Docs: https://www.ncbi.nlm.nih.gov/books/NBK25501/

import { XMLParser } from "fast-xml-parser";

const EUTILS_BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";

export interface PubmedRecord {
  pmid: string;
  title: string;
  abstract: string;
  url: string;
}

function authParams(): string {
  const params = new URLSearchParams();
  const key = process.env.NCBI_API_KEY;
  const email = process.env.NCBI_EMAIL;
  if (key) params.set("api_key", key);
  if (email) params.set("email", email);
  params.set("tool", "papertrail");
  return params.toString();
}

/** Search PubMed for candidate PMIDs matching a free-text query. */
export async function searchPubmed(query: string, retmax = 5): Promise<string[]> {
  const params = new URLSearchParams({
    db: "pubmed",
    term: query,
    retmode: "json",
    retmax: String(retmax),
  });
  const res = await fetch(`${EUTILS_BASE}/esearch.fcgi?${params}&${authParams()}`);
  if (!res.ok) throw new Error(`PubMed esearch failed: ${res.status}`);
  const data = await res.json();
  return data?.esearchresult?.idlist ?? [];
}

/** Fetch title + abstract for a list of PMIDs. */
export async function fetchPubmedRecords(pmids: string[]): Promise<PubmedRecord[]> {
  if (pmids.length === 0) return [];
  const params = new URLSearchParams({
    db: "pubmed",
    id: pmids.join(","),
    rettype: "abstract",
    retmode: "xml",
  });
  const res = await fetch(`${EUTILS_BASE}/efetch.fcgi?${params}&${authParams()}`);
  if (!res.ok) throw new Error(`PubMed efetch failed: ${res.status}`);
  const xml = await res.text();
  return parsePubmedXml(xml);
}

// PubMed XML is verbose; fast-xml-parser walks the real document structure
// (PubmedArticleSet > PubmedArticle > MedlineCitation > Article) instead of regex,
// which protects the "flagged_spans map to exact raw_text substring" invariant from
// entity/nested-tag corruption. ArticleTitle/AbstractText are treated as raw leaves
// then cleaned, so inline markup (<i>, <sup>) can't reorder the extracted text.
const XML = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  stopNodes: ["*.ArticleTitle", "*.AbstractText"],
  parseTagValue: false,
});

function parsePubmedXml(xml: string): PubmedRecord[] {
  let doc: any;
  try {
    doc = XML.parse(xml);
  } catch {
    return [];
  }
  const set = doc?.PubmedArticleSet?.PubmedArticle;
  if (!set) return [];
  const articles: any[] = Array.isArray(set) ? set : [set];

  const records: PubmedRecord[] = [];
  for (const art of articles) {
    const citation = art?.MedlineCitation ?? {};
    const pmid = leafText(citation?.PMID);
    if (!/^\d+$/.test(pmid)) continue;

    const article = citation?.Article ?? {};
    const title = cleanText(rawLeaf(article?.ArticleTitle));
    const abstract = collectAbstract(article?.Abstract?.AbstractText);
    if (!abstract) continue; // skip records with no usable text

    records.push({
      pmid,
      title,
      abstract,
      url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
    });
  }
  return records;
}

// PMID may be a string/number, or an object { "#text": ..., "@_Version": ... }.
function leafText(node: unknown): string {
  if (node == null) return "";
  if (typeof node === "object") return String((node as any)["#text"] ?? "").trim();
  return String(node).trim();
}

// A stopNode leaf (ArticleTitle/AbstractText) is raw inner XML as a string, or an
// object whose "#text" holds that raw content when it carries attributes (e.g. Label).
function rawLeaf(node: unknown): string {
  if (node == null) return "";
  if (typeof node === "object") return String((node as any)["#text"] ?? "");
  return String(node);
}

function collectAbstract(nodes: unknown): string {
  if (nodes == null) return "";
  const arr = Array.isArray(nodes) ? nodes : [nodes];
  return arr.map((n) => cleanText(rawLeaf(n))).filter(Boolean).join(" ");
}

// Strip residual inline tags, decode common XML entities, collapse whitespace.
function cleanText(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");
}
