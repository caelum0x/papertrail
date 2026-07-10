#!/usr/bin/env python3
"""PaperTrail-native ingest bridge: OpenFDA FAERS drug adverse-event reports.

This is a PAPERTRAIL-NATIVE ingest engine (we own this stack). It is NOT one of the
17 vendored OSS engines. It fetches spontaneous adverse-event report data from the
public OpenFDA FAERS API and normalizes it into the cacheable "source" record shape
that PaperTrail's TypeScript ingest drivers (lib/ingest/drivers/*.ts) consume.

Contract (stdout is a single JSON object):

    {"records": [
        {
          "external_id": str,   # stable per (drug, event-signature) — the cache key
          "title": str,
          "raw_text": str,      # offset-preserving; drivers ground spans into this
          "url": str,
          "metadata": {...},    # counts, contingency inputs, query echo (no free text)
          "license": str,
          "snapshot_id": str    # deterministic sha256 over normalized content
        }, ...
    ]}

Moat rules honored here:
  * stdlib-only (urllib/json/hashlib/argparse) — no third-party deps, no install.
  * cache-once friendly: snapshot_id is a deterministic content hash, so re-ingesting
    the same upstream payload yields the identical id and the TS driver can skip the
    embed/insert (never re-fetch on a path a cached row can serve).
  * deterministic where numbers are involved: counts are copied verbatim from OpenFDA;
    nothing is inferred or rounded.
  * never logs raw source/claim text: only ids/counts go to stderr, and the query is
    read from stdin/args (never echoed into a log line).

Input (either --arg '<json-or-query>' OR a JSON object / bare query on stdin):

    {"query": "atorvastatin", "entity": {"surface": "...", "curie": "...",
      "type": "chemical"}, "limit": 25}

A bare non-JSON string is treated as the drug query.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional, Tuple

# --- Constants ----------------------------------------------------------------

SOURCE_TYPE = "faers"
OPENFDA_EVENT_ENDPOINT = "https://api.fda.gov/drug/event.json"
# OpenFDA data is a work of the U.S. federal government: public domain, no rights
# reserved. We still surface the provenance string on every record.
LICENSE = "OpenFDA / FDA FAERS — U.S. Government public domain."
DEFAULT_LIMIT = 25
MAX_LIMIT = 100
HTTP_TIMEOUT_S = 20
USER_AGENT = "PaperTrail-Ingest/1.0 (+https://papertrail; FAERS bridge)"
# Minimum reports at which a per-reaction row is worth surfacing as a source. A
# single spontaneous report is noise; PaperTrail's pharmacovigilance engine gates
# signals at a>=3, so we emit rows down to 1 but flag the count for the driver.
MIN_REACTION_COUNT = 1


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


def _snapshot_id(source_type: str, external_id: str, raw_text: str) -> str:
    """Deterministic content hash. Same normalized content -> same id, always, so
    the TS driver treats a re-ingest as a cache hit rather than a new row."""
    h = hashlib.sha256()
    h.update(source_type.encode("utf-8"))
    h.update(b"\x00")
    h.update(external_id.encode("utf-8"))
    h.update(b"\x00")
    h.update(raw_text.encode("utf-8"))
    return f"sha256:{h.hexdigest()}"


def _external_id(drug: str, reaction: str) -> str:
    """Stable cache key for a (drug, reaction) pair, independent of report ordering
    or fetch time. Lowercased + hashed so punctuation/case can't split the key."""
    basis = f"{drug.strip().lower()}|{reaction.strip().lower()}"
    digest = hashlib.sha256(basis.encode("utf-8")).hexdigest()[:16]
    return f"faers:{digest}"


# --- Input parsing ------------------------------------------------------------


def _read_input(arg_value: Optional[str]) -> Dict[str, Any]:
    """Resolve the ingest input from --arg or stdin. Accepts a JSON object or a
    bare query string in either position. Never echoes the value to a log."""
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


def _resolve_drug_query(payload: Dict[str, Any]) -> str:
    """Pick the drug term: explicit query wins, else the entity surface form."""
    query = _as_text(payload.get("query"))
    if query:
        return query
    entity = payload.get("entity")
    if isinstance(entity, dict):
        surface = _as_text(entity.get("surface"))
        if surface:
            return surface
    return ""


# --- OpenFDA fetch ------------------------------------------------------------


def _http_get_json(url: str) -> Optional[Dict[str, Any]]:
    """GET a URL and parse JSON. Returns None on any HTTP/parse failure (honest
    empty result — a wrong 'confident' answer is worse than 'couldn't verify')."""
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT_S) as resp:
            body = resp.read()
    except urllib.error.HTTPError as exc:
        # 404 from OpenFDA means "no matching reports" — a valid empty, not an error.
        if exc.code == 404:
            return {"results": []}
        return None
    except (urllib.error.URLError, TimeoutError, OSError):
        return None
    try:
        parsed = json.loads(body.decode("utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError):
        return None
    return parsed if isinstance(parsed, dict) else None


def _build_event_count_url(drug: str, limit: int) -> str:
    """OpenFDA 'count by reaction' query for one drug. Uses the generic-name and
    brand-name fields OR'd together so either resolves the same drug."""
    # OpenFDA search: match the drug in either generic or brand name field.
    escaped = drug.replace('"', "")
    search = (
        f'(patient.drug.openfda.generic_name:"{escaped}"'
        f'+patient.drug.openfda.brand_name:"{escaped}")'
    )
    params = {
        "search": search,
        "count": "patient.reaction.reactionmeddrapt.exact",
    }
    query = urllib.parse.urlencode(params, quote_via=urllib.parse.quote)
    return f"{OPENFDA_EVENT_ENDPOINT}?{query}"


def _fetch_total_reports(drug: str) -> Optional[int]:
    """Total FAERS reports mentioning the drug (denominator context). None if the
    meta total is unavailable; the driver treats None as 'unknown', not zero."""
    escaped = drug.replace('"', "")
    search = (
        f'(patient.drug.openfda.generic_name:"{escaped}"'
        f'+patient.drug.openfda.brand_name:"{escaped}")'
    )
    params = {"search": search, "limit": "1"}
    query = urllib.parse.urlencode(params, quote_via=urllib.parse.quote)
    payload = _http_get_json(f"{OPENFDA_EVENT_ENDPOINT}?{query}")
    if not payload:
        return None
    meta = payload.get("meta")
    if isinstance(meta, dict):
        results_meta = meta.get("results")
        if isinstance(results_meta, dict):
            total = results_meta.get("total")
            if isinstance(total, int):
                return total
    return None


def _parse_reaction_counts(payload: Dict[str, Any]) -> List[Tuple[str, int]]:
    """Extract [(reaction_term, count), ...] from an OpenFDA count response."""
    results = payload.get("results")
    if not isinstance(results, list):
        return []
    rows: List[Tuple[str, int]] = []
    for item in results:
        if not isinstance(item, dict):
            continue
        term = _as_text(item.get("term"))
        count = item.get("count")
        if term and isinstance(count, int) and count >= MIN_REACTION_COUNT:
            rows.append((term, count))
    return rows


# --- Normalization to the cacheable source shape ------------------------------


def _landing_url(drug: str) -> str:
    q = urllib.parse.quote(drug)
    return f"https://api.fda.gov/drug/event.json?search=patient.drug.openfda.generic_name:%22{q}%22"


def _build_raw_text(drug: str, reaction: str, count: int, total: Optional[int]) -> str:
    """Offset-preserving natural-language rendering of one drug-reaction signal.
    Kept factual and template-stable so downstream span grounding is deterministic
    and the same inputs always yield byte-identical text (cache-once)."""
    total_clause = (
        f" out of {total} total reports for this drug"
        if isinstance(total, int) and total > 0
        else ""
    )
    return (
        f"FDA FAERS adverse-event reports: the reaction "
        f"\"{reaction}\" was reported in {count} case report(s) involving "
        f"{drug}{total_clause}. Source: FDA Adverse Event Reporting System (FAERS) "
        f"via OpenFDA. Spontaneous reports are a hypothesis-generating signal, not "
        f"proof of causation."
    )


def _to_record(
    drug: str,
    reaction: str,
    count: int,
    total: Optional[int],
) -> Dict[str, Any]:
    external_id = _external_id(drug, reaction)
    raw_text = _build_raw_text(drug, reaction, count, total)
    title = f"FAERS signal: {drug} — {reaction}"
    metadata: Dict[str, Any] = {
        "engine": "faers",
        "drug": drug,
        "reaction": reaction,
        "report_count": count,
        "drug_total_reports": total,
        "count_field": "patient.reaction.reactionmeddrapt.exact",
    }
    return {
        "external_id": external_id,
        "title": title,
        "raw_text": raw_text,
        "url": _landing_url(drug),
        "metadata": metadata,
        "license": LICENSE,
        "snapshot_id": _snapshot_id(SOURCE_TYPE, external_id, raw_text),
    }


def ingest(payload: Dict[str, Any]) -> Dict[str, Any]:
    drug = _resolve_drug_query(payload)
    limit = _clamp_limit(payload.get("limit"))
    if drug == "":
        return {"records": []}

    count_payload = _http_get_json(_build_event_count_url(drug, limit))
    if count_payload is None:
        return {"records": []}

    total = _fetch_total_reports(drug)
    reaction_rows = _parse_reaction_counts(count_payload)[:limit]

    records: List[Dict[str, Any]] = []
    seen: set[str] = set()
    for reaction, count in reaction_rows:
        record = _to_record(drug, reaction, count, total)
        if record["external_id"] in seen:
            continue
        seen.add(record["external_id"])
        records.append(record)

    return {"records": records}


# --- Entry point --------------------------------------------------------------


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description="PaperTrail FAERS ingest bridge (OpenFDA adverse events)."
    )
    parser.add_argument(
        "--arg",
        dest="arg",
        default=None,
        help="JSON ingest input or a bare drug query. If omitted, read from stdin.",
    )
    args = parser.parse_args(argv)

    payload = _read_input(args.arg)
    result = ingest(payload)

    # stderr carries counts only — never the query or any raw text.
    sys.stderr.write(f"faers: emitted {len(result['records'])} record(s)\n")
    sys.stdout.write(json.dumps(result, ensure_ascii=False))
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
