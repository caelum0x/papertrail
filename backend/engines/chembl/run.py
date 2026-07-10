#!/usr/bin/env python3
"""PaperTrail-native ingest bridge: ChEMBL molecule / mechanism records (EMBL-EBI).

This is a PAPERTRAIL-NATIVE ingest engine (we own this stack). It is NOT one of the
17 vendored OSS engines. It fetches drug-like molecule records (and their mechanisms
of action) from the public ChEMBL REST API and normalizes them into the cacheable
"source" record shape that PaperTrail's TypeScript ingest drivers
(lib/ingest/drivers/*.ts) consume.

Contract (stdout is a single JSON object):

    {"records": [
        {
          "external_id": str,   # "chembl:<CHEMBL_ID>" — the cache key
          "title": str,
          "raw_text": str,      # offset-preserving; drivers ground spans into this
          "url": str,
          "metadata": {...},    # max_phase, molecule_type, mechanisms, targets
          "license": str,
          "snapshot_id": str    # deterministic sha256 over normalized content
        }, ...
    ]}

Moat rules honored here:
  * stdlib-only (urllib/json/hashlib/argparse) — no third-party deps, no install.
  * cache-once friendly: external_id is the stable ChEMBL id and snapshot_id is a
    deterministic content hash, so re-ingesting the same record is a cache hit.
  * deterministic where numbers are involved: max clinical phase is copied verbatim
    from ChEMBL; nothing is inferred by a model.
  * never logs raw source/claim text: only ids/counts go to stderr; the query is read
    from stdin/args and never echoed into a log line.

Input (either --arg '<json-or-query>' OR a JSON object / bare query on stdin):

    {"query": "vemurafenib", "entity": {"surface": "...", "curie": "CHEMBL1229517",
      "type": "chemical"}, "limit": 25}

A bare non-JSON string is treated as the molecule name query. If the entity CURIE is
a ChEMBL id, it is used as a direct lookup (deterministic, single-molecule).

ATTRIBUTION: ChEMBL is a database of EMBL-EBI, released under CC BY-SA 3.0. Downstream
use must attribute ChEMBL and share derivative databases under the same license.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional

# --- Constants ----------------------------------------------------------------

SOURCE_TYPE = "chembl"
CHEMBL_BASE = "https://www.ebi.ac.uk/chembl/api/data"
LICENSE = "Data from ChEMBL (EMBL-EBI), CC BY-SA 3.0."
DEFAULT_LIMIT = 25
MAX_LIMIT = 100
HTTP_TIMEOUT_S = 20
USER_AGENT = "PaperTrail-Ingest/1.0 (+https://papertrail; ChEMBL bridge)"
# Cap mechanism rows pulled per molecule so a promiscuous compound can't balloon text.
MAX_MECHANISMS = 20

_CHEMBL_ID_RE = re.compile(r"^CHEMBL\d+$", re.IGNORECASE)


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


def _as_int(value: Any) -> Optional[int]:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, str):
        try:
            return int(value.strip())
        except ValueError:
            return None
    return None


def _snapshot_id(source_type: str, external_id: str, raw_text: str) -> str:
    h = hashlib.sha256()
    h.update(source_type.encode("utf-8"))
    h.update(b"\x00")
    h.update(external_id.encode("utf-8"))
    h.update(b"\x00")
    h.update(raw_text.encode("utf-8"))
    return f"sha256:{h.hexdigest()}"


def _curie_to_chembl_id(curie: str) -> Optional[str]:
    """Accept 'CHEMBL123', 'chembl:CHEMBL123', or a bare id. None if not a ChEMBL id."""
    text = curie.strip()
    if ":" in text:
        prefix, _, rest = text.partition(":")
        if prefix.lower() == "chembl":
            text = rest.strip()
    if _CHEMBL_ID_RE.match(text):
        return text.upper()
    return None


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


def _resolve_query(payload: Dict[str, Any]) -> str:
    query = _as_text(payload.get("query"))
    if query:
        return query
    entity = payload.get("entity")
    if isinstance(entity, dict):
        surface = _as_text(entity.get("surface"))
        if surface:
            return surface
    return ""


def _resolve_direct_id(payload: Dict[str, Any]) -> Optional[str]:
    """A ChEMBL id supplied via entity.curie (or a bare-id query) enables a direct,
    deterministic single-molecule lookup — no name search ambiguity."""
    entity = payload.get("entity")
    if isinstance(entity, dict):
        curie = _as_text(entity.get("curie"))
        if curie:
            direct = _curie_to_chembl_id(curie)
            if direct:
                return direct
    query = _as_text(payload.get("query"))
    if query:
        return _curie_to_chembl_id(query)
    return None


# --- ChEMBL REST fetch --------------------------------------------------------


def _http_get_json(url: str) -> Optional[Dict[str, Any]]:
    req = urllib.request.Request(
        url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"}
    )
    try:
        with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT_S) as resp:
            body = resp.read()
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            return {}
        return None
    except (urllib.error.URLError, TimeoutError, OSError):
        return None
    try:
        parsed = json.loads(body.decode("utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError):
        return None
    return parsed if isinstance(parsed, dict) else None


def _search_molecules(name: str, limit: int) -> List[Dict[str, Any]]:
    """Search ChEMBL molecules by preferred name (case-insensitive)."""
    params = {
        "pref_name__icontains": name,
        "limit": str(limit),
        "format": "json",
    }
    url = f"{CHEMBL_BASE}/molecule?{urllib.parse.urlencode(params, quote_via=urllib.parse.quote)}"
    payload = _http_get_json(url)
    if not payload:
        return []
    molecules = payload.get("molecules")
    return molecules if isinstance(molecules, list) else []


def _fetch_molecule(chembl_id: str) -> Optional[Dict[str, Any]]:
    url = f"{CHEMBL_BASE}/molecule/{urllib.parse.quote(chembl_id)}?format=json"
    payload = _http_get_json(url)
    if not payload:
        return None
    # A single-molecule lookup returns the molecule object directly.
    if _as_text(payload.get("molecule_chembl_id")):
        return payload
    molecules = payload.get("molecules")
    if isinstance(molecules, list) and molecules and isinstance(molecules[0], dict):
        return molecules[0]
    return None


def _fetch_mechanisms(chembl_id: str) -> List[Dict[str, Any]]:
    """Mechanism-of-action rows for a molecule. Empty list on any failure."""
    params = {
        "molecule_chembl_id": chembl_id,
        "limit": str(MAX_MECHANISMS),
        "format": "json",
    }
    url = f"{CHEMBL_BASE}/mechanism?{urllib.parse.urlencode(params, quote_via=urllib.parse.quote)}"
    payload = _http_get_json(url)
    if not payload:
        return []
    mechanisms = payload.get("mechanisms")
    return mechanisms if isinstance(mechanisms, list) else []


# --- Field extraction ---------------------------------------------------------


def _molecule_id(mol: Dict[str, Any]) -> str:
    return _as_text(mol.get("molecule_chembl_id"))


def _molecule_name(mol: Dict[str, Any]) -> str:
    name = _as_text(mol.get("pref_name"))
    return name or _molecule_id(mol)


def _molecule_type(mol: Dict[str, Any]) -> str:
    return _as_text(mol.get("molecule_type")) or "Unknown"


def _max_phase(mol: Dict[str, Any]) -> Optional[int]:
    return _as_int(mol.get("max_phase"))


def _mechanism_summaries(mechanisms: List[Dict[str, Any]]) -> List[Dict[str, str]]:
    summaries: List[Dict[str, str]] = []
    for m in mechanisms:
        if not isinstance(m, dict):
            continue
        action = _as_text(m.get("mechanism_of_action"))
        action_type = _as_text(m.get("action_type"))
        target = _as_text(m.get("target_chembl_id"))
        if action or target:
            summaries.append(
                {
                    "mechanism_of_action": action,
                    "action_type": action_type,
                    "target_chembl_id": target,
                }
            )
    return summaries


# --- Normalization to the cacheable source shape ------------------------------


def _landing_url(chembl_id: str) -> str:
    return f"https://www.ebi.ac.uk/chembl/explore/compound/{urllib.parse.quote(chembl_id)}"


_PHASE_LABEL: Dict[int, str] = {
    0: "preclinical (no clinical phase)",
    1: "Phase 1",
    2: "Phase 2",
    3: "Phase 3",
    4: "approved (Phase 4)",
}


def _phase_clause(max_phase: Optional[int]) -> str:
    if max_phase is None:
        return "with an unrecorded maximum clinical phase"
    label = _PHASE_LABEL.get(max_phase, f"phase {max_phase}")
    return f"with a maximum clinical development phase of {label}"


def _build_raw_text(
    name: str,
    chembl_id: str,
    mol_type: str,
    max_phase: Optional[int],
    mechanisms: List[Dict[str, str]],
) -> str:
    """Offset-preserving, template-stable rendering of one ChEMBL molecule record."""
    mech_clause = ""
    if mechanisms:
        parts: List[str] = []
        for m in mechanisms:
            action = m["mechanism_of_action"] or "mechanism not specified"
            action_type = m["action_type"]
            target = m["target_chembl_id"]
            piece = action
            if action_type:
                piece += f" ({action_type})"
            if target:
                piece += f" on target {target}"
            parts.append(piece)
        mech_clause = " Mechanism(s) of action: " + "; ".join(parts) + "."
    return (
        f"ChEMBL molecule record for {name} ({chembl_id}), a {mol_type} "
        f"{_phase_clause(max_phase)}.{mech_clause} Source: ChEMBL (EMBL-EBI). Clinical "
        f"phase reflects the highest phase reached by any indication for this molecule "
        f"in ChEMBL, not approval for a specific indication."
    )


def _to_record(mol: Dict[str, Any], mechanisms: List[Dict[str, str]]) -> Optional[Dict[str, Any]]:
    chembl_id = _molecule_id(mol)
    if not chembl_id:
        return None
    external_id = f"chembl:{chembl_id}"
    name = _molecule_name(mol)
    mol_type = _molecule_type(mol)
    max_phase = _max_phase(mol)
    raw_text = _build_raw_text(name, chembl_id, mol_type, max_phase, mechanisms)
    metadata: Dict[str, Any] = {
        "engine": "chembl",
        "molecule_chembl_id": chembl_id,
        "pref_name": name,
        "molecule_type": mol_type,
        "max_phase": max_phase,
        "mechanisms": mechanisms,
    }
    return {
        "external_id": external_id,
        "title": f"ChEMBL: {name} ({chembl_id})",
        "raw_text": raw_text,
        "url": _landing_url(chembl_id),
        "metadata": metadata,
        "license": LICENSE,
        "snapshot_id": _snapshot_id(SOURCE_TYPE, external_id, raw_text),
    }


def ingest(payload: Dict[str, Any]) -> Dict[str, Any]:
    limit = _clamp_limit(payload.get("limit"))

    # Direct id lookup takes precedence: deterministic, single molecule, no ambiguity.
    direct_id = _resolve_direct_id(payload)
    molecules: List[Dict[str, Any]] = []
    if direct_id:
        mol = _fetch_molecule(direct_id)
        if mol:
            molecules = [mol]
    else:
        name = _resolve_query(payload)
        if name == "":
            return {"records": []}
        molecules = _search_molecules(name, limit)[:limit]

    records: List[Dict[str, Any]] = []
    seen: set[str] = set()
    for mol in molecules:
        if not isinstance(mol, dict):
            continue
        chembl_id = _molecule_id(mol)
        if not chembl_id:
            continue
        mechanisms = _mechanism_summaries(_fetch_mechanisms(chembl_id))
        record = _to_record(mol, mechanisms)
        if record is None or record["external_id"] in seen:
            continue
        seen.add(record["external_id"])
        records.append(record)

    return {"records": records}


# --- Entry point --------------------------------------------------------------


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description="PaperTrail ChEMBL ingest bridge (EMBL-EBI molecule REST)."
    )
    parser.add_argument(
        "--arg",
        dest="arg",
        default=None,
        help="JSON ingest input or a bare molecule name. If omitted, read from stdin.",
    )
    args = parser.parse_args(argv)

    payload = _read_input(args.arg)
    result = ingest(payload)

    sys.stderr.write(f"chembl: emitted {len(result['records'])} record(s)\n")
    sys.stdout.write(json.dumps(result, ensure_ascii=False))
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
