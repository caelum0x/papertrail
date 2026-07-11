#!/usr/bin/env python3
"""PaperTrail specialization of BioCypher — a bring-your-own-KG CSV importer.

This file is a PaperTrail-native specialization of the BioCypher engine (this repo owns
the vendored BioCypher tree under backend/engines/biocypher/). Rather than fork or run
upstream's ontology-download / Neo4j-writer machinery, we add ONE standalone file that
re-implements the *deterministic core* of BioCypher's job — pinning a project's own
node/edge vocabulary to the Biolink model and REJECTING relations that violate the
Biolink slot domain/range — as pure, stdlib-only Python with no I/O beyond argv/stdin.

**No other file in this engine is modified.** This module is standalone Python with NO
third-party imports (no biocypher install, no yaml, no networkx, no neo4j, no network),
and this whole directory is excluded from the Next build — zero TypeScript/build impact.

BioCypher's contribution (biocypher/_mapping.py + biocypher/_ontology.py) is to take a
source's own labels and resolve each to a canonical Biolink class via an `is_a`
hierarchy, so heterogeneous inputs speak one ontology. PaperTrail's vocabulary is small,
closed, and known at compile time, so this file encodes that same resolution as an
immutable static table (mirroring lib/kg/biolink.ts) instead of parsing a schema YAML.

What this adds on top of the static typing is the IMPORT-TIME GUARANTEE that matters for
a knowledge graph you can trust: given a nodes CSV and an edges CSV, every edge's
predicate is checked against the Biolink domain (allowed subject categories) and range
(allowed object categories). An ill-typed edge — e.g. a `treats` whose subject is a gene,
or whose object is a drug — is REJECTED with a machine-readable reason, never silently
coerced into the graph. This is the moat rule "prefer honest insufficient over a forced
answer" applied at ingestion: a wrong "confident" edge is worse than an honest rejection.

MOAT / determinism guarantees:
  * NO LLM anywhere — every accept/reject decision is a pure table lookup + set test.
  * Same CSVs in → same {imported, rejected} out, always. No randomness, no network.
  * Closed vocabulary — an unknown entity_type or predicate fails CLOSED (rejected),
    never invented.

USAGE (stdlib only, no install):

    # JSON on stdin: { "nodes": "<nodes csv text>", "edges": "<edges csv text>" }
    echo '{"nodes":"id,entity_type,name\\nNCBIGene:673,gene,BRAF",
           "edges":"subject_id,predicate,object_id\\nNCBIGene:673,associates_with,MESH:D009369"}' \
      | python3 papertrail_byokg.py

    # or via --arg with the same JSON object
    python3 papertrail_byokg.py --arg '{"nodes":"...","edges":"..."}'

CSV shapes (header row required, order-independent):
    nodes: id, entity_type, name
    edges: subject_id, predicate, object_id

OUTPUT (stdout, JSON) — an honest, auditable import summary:

    {
      "nodes":    [ {"id","entity_type","name","biolink_category"}, ... ],
      "edges":    [ {"subject_id","predicate","object_id","biolink_predicate"}, ... ],
      "rejected": [ {"edge": {"subject_id","predicate","object_id"}, "reason": "..."}, ... ],
      "node_count": N, "edge_count": E, "rejected_count": R
    }

The TypeScript mirror `validateAndImportKg` in lib/kg/byoKg.ts performs the SAME
field-for-field validation (reusing lib/kg/biolink.ts) before writing to kg_nodes /
kg_edges and recording a kg_import_batches row. See PAPERTRAIL.md for the mapping.

Bad input → {"error": "..."} on stdout and exit code 2 (never a stack trace).
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import sys
from typing import Dict, List, Tuple

# ---------------------------------------------------------------------------
# Biolink typing table — a VERBATIM mirror of lib/kg/biolink.ts. Kept as immutable
# module-level tuples/dicts so the accept/reject decision is a pure lookup, identical
# to what BioCypher's ontology resolver produces for our closed vocabulary.
# ---------------------------------------------------------------------------

# Our closed entity vocabulary (mirrors KG_ENTITY_TYPES in lib/kg/schemas.ts).
VALID_ENTITY_TYPES: Tuple[str, ...] = (
    "gene",
    "disease",
    "chemical",
    "variant",
    "species",
    "drug",
)

# Our closed predicate vocabulary (mirrors KG_PREDICATES in lib/kg/schemas.ts).
VALID_PREDICATES: Tuple[str, ...] = ("associates_with", "targets", "treats")

# entity_type -> canonical Biolink category (mirrors BIOLINK_CATEGORY).
BIOLINK_CATEGORY: Dict[str, str] = {
    "gene": "biolink:Gene",
    "disease": "biolink:Disease",
    "chemical": "biolink:ChemicalEntity",
    "variant": "biolink:SequenceVariant",
    "species": "biolink:OrganismTaxon",
    "drug": "biolink:Drug",
}

# entity_type -> Biolink is_a ancestor chain, most-specific first (mirrors
# BIOLINK_CATEGORY_ANCESTORS). Enables the same subsumption test BioCypher uses.
BIOLINK_CATEGORY_ANCESTORS: Dict[str, Tuple[str, ...]] = {
    "gene": (
        "biolink:Gene",
        "biolink:GeneOrGeneProduct",
        "biolink:BiologicalEntity",
        "biolink:NamedThing",
    ),
    "disease": (
        "biolink:Disease",
        "biolink:DiseaseOrPhenotypicFeature",
        "biolink:BiologicalEntity",
        "biolink:NamedThing",
    ),
    "chemical": (
        "biolink:ChemicalEntity",
        "biolink:ChemicalOrDrugOrTreatment",
        "biolink:NamedThing",
    ),
    "variant": (
        "biolink:SequenceVariant",
        "biolink:BiologicalEntity",
        "biolink:NamedThing",
    ),
    "species": ("biolink:OrganismTaxon", "biolink:NamedThing"),
    "drug": (
        "biolink:Drug",
        "biolink:ChemicalEntity",
        "biolink:ChemicalOrDrugOrTreatment",
        "biolink:NamedThing",
    ),
}

# predicate -> canonical Biolink predicate (mirrors BIOLINK_PREDICATE).
BIOLINK_PREDICATE: Dict[str, str] = {
    "associates_with": "biolink:associated_with",
    "targets": "biolink:target_for",
    "treats": "biolink:treats",
}

# predicate -> Biolink slot domain (allowed subject categories) and range (allowed
# object categories). Mirrors BIOLINK_PREDICATE_SHAPE. This is the table an ill-typed
# edge is rejected against.
BIOLINK_PREDICATE_SHAPE: Dict[str, Dict[str, Tuple[str, ...]]] = {
    "associates_with": {
        "domain": ("biolink:Gene", "biolink:SequenceVariant"),
        "range": ("biolink:Disease",),
    },
    "targets": {
        "domain": ("biolink:Drug", "biolink:ChemicalEntity"),
        "range": ("biolink:Gene",),
    },
    "treats": {
        "domain": ("biolink:Drug", "biolink:ChemicalEntity"),
        "range": ("biolink:Disease",),
    },
}

REQUIRED_NODE_COLUMNS: Tuple[str, ...] = ("id", "entity_type", "name")
REQUIRED_EDGE_COLUMNS: Tuple[str, ...] = ("subject_id", "predicate", "object_id")


# ---------------------------------------------------------------------------
# Pure typing helpers — the same subsumption + well-typing test as lib/kg/biolink.ts.
# ---------------------------------------------------------------------------


def biolink_ancestors(entity_type: str) -> Tuple[str, ...]:
    """Biolink is_a chain for an entity type, or () for an unknown type."""
    return BIOLINK_CATEGORY_ANCESTORS.get(entity_type, ())


def is_category_a(entity_type: str, biolink_category: str) -> bool:
    """True when a node of entity_type IS-A biolink_category (reflexive)."""
    return biolink_category in biolink_ancestors(entity_type)


def well_typed_reason(
    subject_type: str, predicate: str, object_type: str
) -> str:
    """Return "" when the triple is Biolink-well-typed, else a human-readable reason.

    Fails CLOSED: an unknown predicate, or a subject/object whose category does not
    descend from the predicate's domain/range, yields a non-empty reason string.
    """
    if predicate not in BIOLINK_PREDICATE_SHAPE:
        return f"unknown predicate '{predicate}'"

    shape = BIOLINK_PREDICATE_SHAPE[predicate]
    domain = shape["domain"]
    rng = shape["range"]

    subject_ok = any(is_category_a(subject_type, cls) for cls in domain)
    if not subject_ok:
        subject_cat = BIOLINK_CATEGORY.get(subject_type, "unknown")
        return (
            f"subject category {subject_cat} is not in the Biolink domain "
            f"{list(domain)} of predicate '{predicate}'"
        )

    object_ok = any(is_category_a(object_type, cls) for cls in rng)
    if not object_ok:
        object_cat = BIOLINK_CATEGORY.get(object_type, "unknown")
        return (
            f"object category {object_cat} is not in the Biolink range "
            f"{list(rng)} of predicate '{predicate}'"
        )

    return ""


# ---------------------------------------------------------------------------
# CSV parsing — strict, header-required, fails CLOSED on missing columns.
# ---------------------------------------------------------------------------


class BadInput(Exception):
    """Raised for any malformed input; mapped to {"error"} + exit 2 at the boundary."""


def _parse_csv(text: str, required: Tuple[str, ...], what: str) -> List[Dict[str, str]]:
    if not isinstance(text, str) or text.strip() == "":
        raise BadInput(f"'{what}' CSV is empty")

    reader = csv.DictReader(io.StringIO(text))
    fieldnames = reader.fieldnames
    if not fieldnames:
        raise BadInput(f"'{what}' CSV has no header row")

    header = [(name or "").strip() for name in fieldnames]
    missing = [col for col in required if col not in header]
    if missing:
        raise BadInput(
            f"'{what}' CSV is missing required column(s): {missing}; "
            f"expected header {list(required)}"
        )

    rows: List[Dict[str, str]] = []
    for raw_row in reader:
        row: Dict[str, str] = {}
        for key in required:
            value = raw_row.get(key)
            row[key] = value.strip() if isinstance(value, str) else ""
        rows.append(row)
    return rows


# ---------------------------------------------------------------------------
# Validation + "import" (in-process; the TS mirror does the DB write).
# ---------------------------------------------------------------------------


def _validate_nodes(
    rows: List[Dict[str, str]],
) -> Tuple[Dict[str, str], List[Dict[str, str]]]:
    """Return (id -> entity_type map for valid nodes, list of accepted node records).

    A node with an unknown entity_type, a blank id, or a blank name is DROPPED (its id
    is simply absent from the map), so any edge referencing it will later be rejected
    as an unresolved endpoint. We never invent a category for an unknown type.
    """
    types_by_id: Dict[str, str] = {}
    accepted: List[Dict[str, str]] = []
    for row in rows:
        node_id = row["id"]
        entity_type = row["entity_type"]
        name = row["name"]
        if node_id == "" or name == "" or entity_type not in BIOLINK_CATEGORY:
            continue
        # Last valid row for a given id wins; keep the accepted list deduplicated by id.
        if node_id not in types_by_id:
            accepted.append(
                {
                    "id": node_id,
                    "entity_type": entity_type,
                    "name": name,
                    "biolink_category": BIOLINK_CATEGORY[entity_type],
                }
            )
        types_by_id[node_id] = entity_type
    return types_by_id, accepted


def _validate_edges(
    rows: List[Dict[str, str]], types_by_id: Dict[str, str]
) -> Tuple[List[Dict[str, str]], List[Dict[str, object]]]:
    """Split edges into (accepted, rejected) by Biolink domain/range well-typing.

    An edge is rejected — with a reason — if: its subject or object id is not a valid
    node, its predicate is outside the closed vocabulary, or the (subject_type,
    predicate, object_type) triple violates the Biolink slot domain/range. Nothing is
    coerced.
    """
    accepted: List[Dict[str, str]] = []
    rejected: List[Dict[str, object]] = []

    for row in rows:
        subject_id = row["subject_id"]
        predicate = row["predicate"]
        object_id = row["object_id"]
        edge_ref = {
            "subject_id": subject_id,
            "predicate": predicate,
            "object_id": object_id,
        }

        if subject_id == "" or object_id == "" or predicate == "":
            rejected.append(
                {"edge": edge_ref, "reason": "edge has a blank subject, predicate, or object"}
            )
            continue

        if predicate not in BIOLINK_PREDICATE:
            rejected.append(
                {"edge": edge_ref, "reason": f"unknown predicate '{predicate}'"}
            )
            continue

        subject_type = types_by_id.get(subject_id)
        if subject_type is None:
            rejected.append(
                {
                    "edge": edge_ref,
                    "reason": f"subject '{subject_id}' is not a valid node in the nodes CSV",
                }
            )
            continue

        object_type = types_by_id.get(object_id)
        if object_type is None:
            rejected.append(
                {
                    "edge": edge_ref,
                    "reason": f"object '{object_id}' is not a valid node in the nodes CSV",
                }
            )
            continue

        reason = well_typed_reason(subject_type, predicate, object_type)
        if reason:
            rejected.append({"edge": edge_ref, "reason": reason})
            continue

        accepted.append(
            {
                "subject_id": subject_id,
                "predicate": predicate,
                "object_id": object_id,
                "biolink_predicate": BIOLINK_PREDICATE[predicate],
            }
        )

    return accepted, rejected


def import_kg(payload: Dict[str, object]) -> Dict[str, object]:
    """Validate a { nodes, edges } CSV payload and return an import summary.

    Pure and deterministic: no I/O, no LLM, no randomness. Ill-typed edges are rejected
    with reasons rather than coerced.
    """
    nodes_text = payload.get("nodes")
    edges_text = payload.get("edges")
    if not isinstance(nodes_text, str):
        raise BadInput("'nodes' must be a CSV string")
    if not isinstance(edges_text, str):
        raise BadInput("'edges' must be a CSV string")

    node_rows = _parse_csv(nodes_text, REQUIRED_NODE_COLUMNS, "nodes")
    edge_rows = _parse_csv(edges_text, REQUIRED_EDGE_COLUMNS, "edges")

    types_by_id, accepted_nodes = _validate_nodes(node_rows)
    accepted_edges, rejected_edges = _validate_edges(edge_rows, types_by_id)

    return {
        "nodes": accepted_nodes,
        "edges": accepted_edges,
        "rejected": rejected_edges,
        "node_count": len(accepted_nodes),
        "edge_count": len(accepted_edges),
        "rejected_count": len(rejected_edges),
    }


# ---------------------------------------------------------------------------
# CLI boundary — JSON on --arg or stdin, JSON to stdout, honest error + exit 2.
# ---------------------------------------------------------------------------


def _read_payload(arg_value: str | None) -> Dict[str, object]:
    if arg_value is not None:
        source = arg_value
    else:
        source = sys.stdin.read()
    if source.strip() == "":
        raise BadInput("no input provided on --arg or stdin")
    try:
        parsed = json.loads(source)
    except json.JSONDecodeError as exc:
        raise BadInput(f"input is not valid JSON: {exc}") from exc
    if not isinstance(parsed, dict):
        raise BadInput("input JSON must be an object with 'nodes' and 'edges' keys")
    return parsed


def main(argv: List[str]) -> int:
    parser = argparse.ArgumentParser(
        description="PaperTrail BioCypher BYO-KG CSV importer with Biolink domain/range validation."
    )
    parser.add_argument(
        "--arg",
        dest="arg",
        default=None,
        help='JSON object {"nodes": "<csv>", "edges": "<csv>"}; if omitted, read from stdin.',
    )
    args = parser.parse_args(argv)

    try:
        payload = _read_payload(args.arg)
        result = import_kg(payload)
    except BadInput as exc:
        json.dump({"error": str(exc)}, sys.stdout)
        sys.stdout.write("\n")
        return 2

    json.dump(result, sys.stdout, separators=(",", ":"))
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
