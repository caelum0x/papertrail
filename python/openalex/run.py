#!/usr/bin/env python3
"""OpenAlex Works search — zero-dependency stdin/stdout bridge.

Bridge: lib/engines/openalex.ts (searchOpenAlex). Reads a JSON job on stdin
{"query": str, "limit"?: int, "email"?: str} and emits exactly one JSON object
on stdout:

  success: {"ok": true, "works": [
      {"openalex_id", "title", "abstract", "doi", "year",
       "cited_by_count", "is_retracted"}, ...]}
  handled error: {"ok": false, "error": "..."}  (exit 1)

Uses only the Python standard library (urllib) — no pip dependencies, works out
of the box. Queries the public OpenAlex REST API. The caller's query text is read
from stdin only and is never logged.
"""
import json
import sys
import urllib.parse
import urllib.request

OPENALEX_ENDPOINT = "https://api.openalex.org/works"
DEFAULT_LIMIT = 10
MAX_LIMIT = 200  # OpenAlex per-page cap
HTTP_TIMEOUT_S = 25


def _short_id(full_id):
    """Turn 'https://openalex.org/W123' into 'W123' (leave other shapes as-is)."""
    if not isinstance(full_id, str) or not full_id:
        return None
    return full_id.rstrip("/").rsplit("/", 1)[-1] or None


def _bare_doi(doi):
    """Strip the 'https://doi.org/' prefix so the caller gets a bare DOI."""
    if not isinstance(doi, str) or not doi:
        return None
    for prefix in ("https://doi.org/", "http://doi.org/", "doi.org/"):
        if doi.startswith(prefix):
            return doi[len(prefix):]
    return doi


def _reconstruct_abstract(inverted_index):
    """Rebuild abstract text from OpenAlex's inverted-index representation."""
    if not isinstance(inverted_index, dict) or not inverted_index:
        return None
    positioned = []
    for word, positions in inverted_index.items():
        if not isinstance(positions, list):
            continue
        for pos in positions:
            if isinstance(pos, int):
                positioned.append((pos, word))
    if not positioned:
        return None
    positioned.sort(key=lambda pair: pair[0])
    return " ".join(word for _pos, word in positioned)


def _digest(work):
    idx = work.get("abstract_inverted_index")
    year = work.get("publication_year")
    cited = work.get("cited_by_count")
    return {
        "openalex_id": _short_id(work.get("id")),
        "title": work.get("title"),
        "abstract": _reconstruct_abstract(idx),
        "doi": _bare_doi(work.get("doi")),
        "year": int(year) if isinstance(year, int) else None,
        "cited_by_count": int(cited) if isinstance(cited, int) else None,
        "is_retracted": bool(work.get("is_retracted", False)),
    }


def search(job):
    query = job.get("query")
    if not isinstance(query, str) or not query.strip():
        return {"ok": False, "error": "openalex: a non-empty 'query' is required"}

    limit = job.get("limit")
    if not isinstance(limit, int) or limit <= 0:
        limit = DEFAULT_LIMIT
    limit = min(limit, MAX_LIMIT)

    params = {
        "search": query,
        "per-page": str(limit),
        "select": "id,title,abstract_inverted_index,doi,publication_year,"
                  "cited_by_count,is_retracted",
    }
    email = job.get("email")
    if isinstance(email, str) and email.strip():
        params["mailto"] = email.strip()  # OpenAlex polite pool

    url = OPENALEX_ENDPOINT + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": "PaperTrail/1.0 (openalex bridge)"})
    with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT_S) as resp:  # noqa: S310 (fixed https host)
        payload = json.loads(resp.read().decode("utf-8"))

    results = payload.get("results")
    if not isinstance(results, list):
        return {"ok": False, "error": "openalex: unexpected response shape (no results array)"}

    works = [_digest(w) for w in results if isinstance(w, dict)]
    return {"ok": True, "works": works}


def main():
    try:
        raw = sys.stdin.read()
        job = json.loads(raw) if raw.strip() else {}
        out = search(job)
        print(json.dumps(out))
        return 0 if out.get("ok") else 1
    except Exception as exc:  # noqa: BLE001 — surface every failure as a JSON envelope
        print(json.dumps({"ok": False, "error": f"{type(exc).__name__}: {exc}"}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
