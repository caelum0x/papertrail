#!/usr/bin/env python3
"""PaperTrail-native ingest bridge: NCBI ClinVar variant interpretations.

This is a PAPERTRAIL-NATIVE ingest engine (we own this stack). It is NOT one of the
17 vendored OSS engines. It fetches variant clinical-significance records from the
public NCBI E-utilities (esearch + esummary) over the ClinVar database and normalizes
them into the cacheable "source" record shape that PaperTrail's TypeScript ingest
drivers (lib/ingest/drivers/*.ts) consume.

Contract (stdout is a single JSON object):

    {"records": [
        {
          "external_id": str,   # "clinvar:<VariationID>" — the cache key
          "title": str,
          "raw_text": str,      # offset-preserving; drivers ground spans into this
          "url": str,
          "metadata": {...},    # clinical significance, review status, stars, genes
          "license": str,
          "snapshot_id": str    # deterministic sha256 over normalized content
        }, ...
    ]}

Moat rules honored here:
  * stdlib-only (urllib/json/hashlib/argparse) — no third-party deps, no install.
  * cache-once friendly: external_id is the stable ClinVar VariationID and snapshot_id
    is a deterministic content hash, so re-ingesting the same record is a cache hit.
  * deterministic where numbers are involved: gold-star review level is mapped from
    ClinVar's documented review-status scale (verbatim), never inferred by a model.
  * never logs raw source/claim text: only ids/counts go to stderr; the query is read
    from stdin/args and never echoed into a log line.

Input (either --arg '<json-or-query>' OR a JSON object / bare query on stdin):

    {"query": "BRCA1 pathogenic", "entity": {"surface": "rs80357906",
      "curie": "...", "type": "variant"}, "limit": 25}

A bare non-JSON string is treated as the ClinVar search term.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional

# --- Constants ----------------------------------------------------------------

SOURCE_TYPE = "clinvar"
EUTILS_BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"
ESEARCH = f"{EUTILS_BASE}/esearch.fcgi"
ESUMMARY = f"{EUTILS_BASE}/esummary.fcgi"
# ClinVar aggregate data is in the public domain:
# https://www.ncbi.nlm.nih.gov/clinvar/docs/maintenance_use/
LICENSE = "NCBI ClinVar — public domain (NLM / NCBI)."
DEFAULT_LIMIT = 25
MAX_LIMIT = 100
HTTP_TIMEOUT_S = 20
USER_AGENT = "PaperTrail-Ingest/1.0 (+https://papertrail; ClinVar bridge)"

# ClinVar review status -> gold-star rating. Documented, fixed mapping (mirrors
# lib/bio/variantPathogenicity.ts STAR_BY_REVIEW_STATUS). Anything not listed is 0
# stars (the honest floor), never a guessed rating.
STAR_BY_REVIEW_STATUS: Dict[str, int] = {
    "practice guideline": 4,
    "reviewed by expert panel": 3,
    "criteria provided, multiple submitters, no conflicts": 2,
    "criteria provided, conflicting classifications": 1,
    "criteria provided, conflicting interpretations": 1,
    "criteria provided, single submitter": 1,
    "no assertion criteria provided": 0,
    "no assertion provided": 0,
    "no classification provided": 0,
    "no classification for the individual variant": 0,
}


# --- Small safe helpers -------------------------------------------------------


def _clamp_limit(value: Any) -> int:
    try:
        n = int(value)
    except (TypeError, ValueError):
        return DEFAULT_LIMIT
    if n < 1:
        return 1
    if n > MAX_LIMIT:
        return MAX_LIMIT
    return n


def _as_text(value: Any) -> str:
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, (int, float)):
        return str(value)
    return ""


def _stars_for(review_status: str) -> int:
    return STAR_BY_REVIEW_STATUS.get(review_status.strip().lower(), 0)


def _snapshot_id(source_type: str, external_id: str, raw_text: str) -> str:
    h = hashlib.sha256()
    h.update(source_type.encode("utf-8"))
    h.update(b"\x00")
    h.update(external_id.encode("utf-8"))
    h.update(b"\x00")
    h.update(raw_text.encode("utf-8"))
    return f"sha256:{h.hexdigest()}"


# --- Input parsing ------------------------------------------------------------


def _read_input(arg_value: Optional[str]) -> Dict[str, Any]:
    raw = arg_value
    if raw is None or raw.strip() == "":
        if not sys.stdin.isatty():
            raw = sys.stdin.read()
    if raw is None:
        raw = ""
    raw = raw.strip()
    if raw == "":
        return {}
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, dict):
            return parsed
        if isinstance(parsed, str):
            return {"query": parsed}
    except json.JSONDecodeError:
        return {"query": raw}
    return {"query": raw}


def _resolve_search_term(payload: Dict[str, Any]) -> str:
    query = _as_text(payload.get("query"))
    if query:
        return query
    entity = payload.get("entity")
    if isinstance(entity, dict):
        surface = _as_text(entity.get("surface"))
        if surface:
            return surface
    return ""


# --- E-utilities fetch --------------------------------------------------------


def _eutils_extra_params() -> Dict[str, str]:
    """Optional NCBI api_key / tool / email from env for higher rate limits. Never
    fails if unset; these are read from the process env, not from the query."""
    import os

    extra: Dict[str, str] = {"tool": "papertrail", "retmode": "json"}
    api_key = os.environ.get("NCBI_API_KEY")
    email = os.environ.get("NCBI_EMAIL")
    if api_key:
        extra["api_key"] = api_key
    if email:
        extra["email"] = email
    return extra


def _http_get(url: str) -> Optional[bytes]:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT_S) as resp:
            return resp.read()
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, OSError):
        return None


def _http_get_json(url: str) -> Optional[Dict[str, Any]]:
    body = _http_get(url)
    if body is None:
        return None
    try:
        parsed = json.loads(body.decode("utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError):
        return None
    return parsed if isinstance(parsed, dict) else None


def _esearch_ids(term: str, limit: int) -> List[str]:
    """Resolve ClinVar VariationIDs for a search term. Empty list on any failure."""
    params = {"db": "clinvar", "term": term, "retmax": str(limit)}
    params.update(_eutils_extra_params())
    url = f"{ESEARCH}?{urllib.parse.urlencode(params, quote_via=urllib.parse.quote)}"
    payload = _http_get_json(url)
    if not payload:
        return []
    result = payload.get("esearchresult")
    if not isinstance(result, dict):
        return []
    ids = result.get("idlist")
    if not isinstance(ids, list):
        return []
    return [str(i) for i in ids if _as_text(i)]


def _esummary_docs(ids: List[str]) -> Dict[str, Dict[str, Any]]:
    """Batch esummary for the resolved ids. Returns {uid: docsum-dict}. The JSON
    esummary shape for ClinVar keys docs under result[<uid>]."""
    if not ids:
        return {}
    params = {"db": "clinvar", "id": ",".join(ids)}
    params.update(_eutils_extra_params())
    url = f"{ESUMMARY}?{urllib.parse.urlencode(params, quote_via=urllib.parse.quote)}"
    payload = _http_get_json(url)
    if not payload:
        return {}
    result = payload.get("result")
    if not isinstance(result, dict):
        return {}
    docs: Dict[str, Dict[str, Any]] = {}
    for uid in ids:
        doc = result.get(uid)
        if isinstance(doc, dict):
            docs[uid] = doc
    return docs


# --- Field extraction (defensive across esummary variants) --------------------


def _extract_significance(doc: Dict[str, Any]) -> str:
    """ClinVar's germline classification description, across schema variants."""
    germ = doc.get("germline_classification")
    if isinstance(germ, dict):
        desc = _as_text(germ.get("description"))
        if desc:
            return desc
    clinical = doc.get("clinical_significance")
    if isinstance(clinical, dict):
        desc = _as_text(clinical.get("description"))
        if desc:
            return desc
    return "not provided"


def _extract_review_status(doc: Dict[str, Any]) -> str:
    germ = doc.get("germline_classification")
    if isinstance(germ, dict):
        rs = _as_text(germ.get("review_status"))
        if rs:
            return rs
    clinical = doc.get("clinical_significance")
    if isinstance(clinical, dict):
        rs = _as_text(clinical.get("review_status"))
        if rs:
            return rs
    return "no assertion criteria provided"


def _extract_genes(doc: Dict[str, Any]) -> List[str]:
    genes: List[str] = []
    raw_genes = doc.get("genes")
    if isinstance(raw_genes, list):
        for g in raw_genes:
            if isinstance(g, dict):
                symbol = _as_text(g.get("symbol"))
                if symbol:
                    genes.append(symbol)
    return genes


def _extract_conditions(doc: Dict[str, Any]) -> List[str]:
    conditions: List[str] = []
    germ = doc.get("germline_classification")
    trait_set: Any = None
    if isinstance(germ, dict):
        trait_set = germ.get("trait_set")
    if not isinstance(trait_set, list):
        trait_set = doc.get("trait_set")
    if isinstance(trait_set, list):
        for t in trait_set:
            if isinstance(t, dict):
                name = _as_text(t.get("trait_name"))
                if name:
                    conditions.append(name)
    return conditions


def _extract_title(doc: Dict[str, Any], uid: str) -> str:
    title = _as_text(doc.get("title"))
    if title:
        return title
    name = _as_text(doc.get("variation_set_name")) or _as_text(doc.get("obj_type"))
    return name or f"ClinVar variant {uid}"


# --- Normalization to the cacheable source shape ------------------------------


def _landing_url(uid: str) -> str:
    return f"https://www.ncbi.nlm.nih.gov/clinvar/variation/{uid}/"


def _build_raw_text(
    title: str,
    significance: str,
    review_status: str,
    stars: int,
    genes: List[str],
    conditions: List[str],
) -> str:
    """Offset-preserving, template-stable rendering of one ClinVar interpretation."""
    gene_clause = f" in gene(s) {', '.join(genes)}" if genes else ""
    cond_clause = (
        f" for condition(s) {'; '.join(conditions)}" if conditions else ""
    )
    return (
        f"NCBI ClinVar interpretation for {title}{gene_clause}: the clinical "
        f"significance is \"{significance}\"{cond_clause}. Review status: "
        f"\"{review_status}\" ({stars} gold star(s) on ClinVar's review-confidence "
        f"scale). Source: NCBI ClinVar. A pathogenicity label's strength depends on "
        f"its review status; below one gold star the assertion lacks documented "
        f"assertion criteria."
    )


def _to_record(uid: str, doc: Dict[str, Any]) -> Dict[str, Any]:
    external_id = f"clinvar:{uid}"
    title = _extract_title(doc, uid)
    significance = _extract_significance(doc)
    review_status = _extract_review_status(doc)
    stars = _stars_for(review_status)
    genes = _extract_genes(doc)
    conditions = _extract_conditions(doc)
    raw_text = _build_raw_text(
        title, significance, review_status, stars, genes, conditions
    )
    metadata: Dict[str, Any] = {
        "engine": "clinvar",
        "variation_id": uid,
        "clinical_significance": significance,
        "review_status": review_status,
        "review_stars": stars,
        "genes": genes,
        "conditions": conditions,
        "accession": _as_text(doc.get("accession")),
    }
    return {
        "external_id": external_id,
        "title": f"ClinVar: {title}",
        "raw_text": raw_text,
        "url": _landing_url(uid),
        "metadata": metadata,
        "license": LICENSE,
        "snapshot_id": _snapshot_id(SOURCE_TYPE, external_id, raw_text),
    }


def ingest(payload: Dict[str, Any]) -> Dict[str, Any]:
    term = _resolve_search_term(payload)
    limit = _clamp_limit(payload.get("limit"))
    if term == "":
        return {"records": []}

    ids = _esearch_ids(term, limit)
    if not ids:
        return {"records": []}

    docs = _esummary_docs(ids)

    records: List[Dict[str, Any]] = []
    seen: set[str] = set()
    # Preserve esearch relevance order.
    for uid in ids:
        doc = docs.get(uid)
        if not isinstance(doc, dict):
            continue
        record = _to_record(uid, doc)
        if record["external_id"] in seen:
            continue
        seen.add(record["external_id"])
        records.append(record)

    return {"records": records}


# --- Entry point --------------------------------------------------------------


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description="PaperTrail ClinVar ingest bridge (NCBI E-utilities)."
    )
    parser.add_argument(
        "--arg",
        dest="arg",
        default=None,
        help="JSON ingest input or a bare ClinVar term. If omitted, read from stdin.",
    )
    args = parser.parse_args(argv)

    payload = _read_input(args.arg)
    result = ingest(payload)

    sys.stderr.write(f"clinvar: emitted {len(result['records'])} record(s)\n")
    sys.stdout.write(json.dumps(result, ensure_ascii=False))
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
