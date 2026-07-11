#!/usr/bin/env python3
"""ClinicalTrials.gov trial-landscape search — zero-dependency stdin/stdout bridge.

Bridge: lib/engines/pytrials.ts (searchTrials). Reads a JSON job on stdin
{"query": str, "fields"?: [str], "max"?: int} and emits exactly one JSON object
on stdout:

  success: {"ok": true, "count": int, "studies": [
      {"nctId", "title", "status", "phase", "conditions": [str],
       "interventions": [str], "enrollment": int|null}, ...]}
  handled error: {"ok": false, "error": "..."}  (exit 1)

Uses only the Python standard library (urllib) — no pip dependencies, works out of
the box. Queries the public ClinicalTrials.gov v2 REST API directly. `fields` is
accepted for API symmetry but does not change the digested output. The query text
is read from stdin only and is never logged.
"""
import json
import sys
import urllib.parse
import urllib.request

CTGOV_ENDPOINT = "https://clinicaltrials.gov/api/v2/studies"
DEFAULT_MAX = 20
MAX_PAGE_SIZE = 1000  # ClinicalTrials.gov v2 cap
HTTP_TIMEOUT_S = 45


def _module(protocol, name):
    mod = protocol.get(name)
    return mod if isinstance(mod, dict) else {}


def _str_list(value):
    if not isinstance(value, list):
        return []
    return [v for v in value if isinstance(v, str) and v]


def _digest(study):
    protocol = study.get("protocolSection")
    if not isinstance(protocol, dict):
        return None

    ident = _module(protocol, "identificationModule")
    status_mod = _module(protocol, "statusModule")
    conditions_mod = _module(protocol, "conditionsModule")
    design_mod = _module(protocol, "designModule")
    arms_mod = _module(protocol, "armsInterventionsModule")

    title = ident.get("briefTitle") or ident.get("officialTitle")

    phases = _str_list(design_mod.get("phases"))
    phase = "/".join(phases) if phases else None

    interventions_raw = arms_mod.get("interventions")
    interventions = []
    if isinstance(interventions_raw, list):
        for it in interventions_raw:
            if isinstance(it, dict) and isinstance(it.get("name"), str):
                interventions.append(it["name"])

    enrollment_info = design_mod.get("enrollmentInfo")
    enrollment = None
    if isinstance(enrollment_info, dict):
        count = enrollment_info.get("count")
        if isinstance(count, int):
            enrollment = count

    return {
        "nctId": ident.get("nctId"),
        "title": title,
        "status": status_mod.get("overallStatus"),
        "phase": phase,
        "conditions": _str_list(conditions_mod.get("conditions")),
        "interventions": interventions,
        "enrollment": enrollment,
    }


def search(job):
    query = job.get("query")
    if not isinstance(query, str) or not query.strip():
        return {"ok": False, "error": "pytrials: a non-empty 'query' is required"}

    max_studies = job.get("max")
    if not isinstance(max_studies, int) or max_studies <= 0:
        max_studies = DEFAULT_MAX
    max_studies = min(max_studies, MAX_PAGE_SIZE)

    params = {
        "query.term": query,
        "pageSize": str(max_studies),
        "format": "json",
    }
    url = CTGOV_ENDPOINT + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": "PaperTrail/1.0 (pytrials bridge)"})
    with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT_S) as resp:  # noqa: S310 (fixed https host)
        payload = json.loads(resp.read().decode("utf-8"))

    studies_raw = payload.get("studies")
    if not isinstance(studies_raw, list):
        return {"ok": False, "error": "pytrials: unexpected response shape (no studies array)"}

    studies = []
    for raw in studies_raw:
        if isinstance(raw, dict):
            digested = _digest(raw)
            if digested is not None:
                studies.append(digested)

    return {"ok": True, "count": len(studies), "studies": studies}


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
