# PaperTrail specialization of BioCypher (BYO-KG import)

`papertrail_byokg.py` in this directory is a **PaperTrail-native specialization** of the
BioCypher engine. This repo owns the vendored BioCypher tree; rather than fork or run
upstream's ontology-download / graph-writer machinery, we added one file that
re-implements the *deterministic core* of what BioCypher does — pinning a project's own
node/edge vocabulary to the **Biolink model** and rejecting relations that violate the
Biolink slot **domain/range** — in a way that satisfies PaperTrail's moat rules and is
**field-for-field identical** to the TypeScript path the app actually serves from.

**No other file in this engine is modified.** `papertrail_byokg.py` is standalone,
stdlib-only Python (no `biocypher` install, no `yaml`, no `networkx`, no `neo4j`, no
network), and this whole directory is excluded from the Next build — so there is zero
TypeScript/build impact.

---

## Why it exists

PaperTrail's knowledge graph (`kg_nodes` / `kg_edges`, migration `0052_knowledge-graph.sql`)
is normally assembled from the open bio corpus by the deterministic bio-relation engines.
This feature lets a lab **bring their own KG**: upload a nodes CSV and an edges CSV and
import them into the same graph — but only if each edge is **ontologically well-typed**.
A KG you can trust is one where a `treats` edge really goes drug → disease, not the
reverse; an ill-typed edge silently coerced in would poison every path that traverses it.

BioCypher's contribution (`biocypher/_mapping.py` + `biocypher/_ontology.py`) is to take a
source's own labels and resolve each to a canonical Biolink class via an `is_a` hierarchy,
so heterogeneous inputs speak one ontology. PaperTrail's vocabulary is **small, closed,
and known at compile time** (see `lib/kg/schemas.ts`), so we encode that resolution as an
immutable static table instead of parsing a schema YAML — the same resolution BioCypher
performs, with no I/O and nothing LLM-derived.

| BioCypher step | `papertrail_byokg.py` |
| --- | --- |
| `schema_config.yaml` → leaf class per `input_label` | `BIOLINK_CATEGORY` static table (mirrors `lib/kg/biolink.ts`) |
| Ontology `is_a` walk (`_ontology.py`) to resolve leaves | `BIOLINK_CATEGORY_ANCESTORS` + `is_category_a()` |
| Edge-label → Biolink predicate mapping (`_mapping.py`) | `BIOLINK_PREDICATE` static table |
| Slot `domain`/`range` typing of an association | `BIOLINK_PREDICATE_SHAPE` + `well_typed_reason()` |
| Write nodes/edges to Neo4j/CSV output | (deferred to the TS mirror's SQL write) |

The value this **adds** on top of static typing is the **import-time guarantee**: every
edge predicate is checked against its Biolink domain (allowed subject categories) and
range (allowed object categories). An ill-typed edge is **rejected with a
machine-readable reason**, never coerced. That is the moat rule *"prefer honest
insufficient over a forced answer"* applied at ingestion.

---

## PaperTrail invariants it enforces

- **Deterministic, no LLM** — every accept/reject decision is a pure table lookup + set
  membership test. Same CSVs in → same `{nodes, edges, rejected}` out, always. No
  randomness, no network. Claude never touches a typing decision.
- **Closed vocabulary, fails closed** — an unknown `entity_type` drops the node (so any
  edge referencing it is rejected as an unresolved endpoint); an unknown predicate, or a
  triple violating Biolink domain/range, is rejected. Nothing outside the closed
  vocabulary is invented.
- **Honest rejection over silent coercion** — a `treats` whose subject is a disease, or a
  `targets` whose subject is a gene, is returned in `rejected[]` with the exact reason,
  not quietly flipped or dropped without trace.

---

## CLI contract

Stdlib only, no install. Reads a JSON object on `--arg` or stdin, writes JSON to stdout.

```bash
# JSON on stdin
echo '{"nodes":"id,entity_type,name\nNCBIGene:673,gene,BRAF",
       "edges":"subject_id,predicate,object_id\nNCBIGene:673,associates_with,MESH:D009369"}' \
  | python3 papertrail_byokg.py

# or via --arg with the same JSON object
python3 papertrail_byokg.py --arg '{"nodes":"...","edges":"..."}'
```

**Input** — a JSON object with two CSV-text fields:

| field | CSV columns (header required, order-independent) |
| --- | --- |
| `nodes` | `id`, `entity_type`, `name` |
| `edges` | `subject_id`, `predicate`, `object_id` |

**Output (stdout, JSON)** — an honest, auditable import summary:

```json
{
  "nodes":    [ {"id","entity_type","name","biolink_category"} ],
  "edges":    [ {"subject_id","predicate","object_id","biolink_predicate"} ],
  "rejected": [ {"edge": {"subject_id","predicate","object_id"}, "reason": "..."} ],
  "node_count": 3, "edge_count": 2, "rejected_count": 1
}
```

**On bad input** — `{"error": "..."}` on stdout and **exit code 2** (never a stack trace):
non-JSON input, a non-object payload, a missing/empty CSV, or a CSV missing a required
column header all fail closed with a reason.

---

## Field-for-field mapping to the native TS module

The app serves this feature from **`lib/kg/byoKg.ts`** (`validateAndImportKg`), which
performs the **same** validation by reusing **`lib/kg/biolink.ts`** — the TypeScript port
of the very same Biolink typing table — then writes accepted nodes/edges into `kg_nodes` /
`kg_edges` and records a `kg_import_batches` row.

| `papertrail_byokg.py` | `lib/kg/byoKg.ts` / `lib/kg/biolink.ts` | Meaning |
| --- | --- | --- |
| `VALID_ENTITY_TYPES` | `KG_ENTITY_TYPES` (`lib/kg/schemas.ts`) | closed node vocabulary |
| `VALID_PREDICATES` | `KG_PREDICATES` (`lib/kg/schemas.ts`) | closed predicate vocabulary |
| `BIOLINK_CATEGORY` | `BIOLINK_CATEGORY` | entity_type → Biolink category |
| `BIOLINK_CATEGORY_ANCESTORS` | `BIOLINK_CATEGORY_ANCESTORS` | Biolink `is_a` chain |
| `is_category_a()` | `isCategoryA()` | reflexive subsumption test |
| `BIOLINK_PREDICATE` | `BIOLINK_PREDICATE` | predicate → Biolink predicate CURIE |
| `BIOLINK_PREDICATE_SHAPE` | `BIOLINK_PREDICATE_SHAPE` | predicate slot domain/range |
| `well_typed_reason()` returns `""` | `isWellTypedTriple()` returns `true` | triple accepted |
| `well_typed_reason()` returns a reason | `isWellTypedTriple()` returns `false` (→ `rejected[]` reason) | triple rejected |
| output `nodes[]` | rows inserted into `kg_nodes` | accepted nodes |
| output `edges[]` | rows inserted into `kg_edges` | accepted, well-typed edges |
| output `rejected[]` | `rejected: [{edge, reason}]` returned by `validateAndImportKg` | ill-typed edges + reasons |
| output counts | `kg_import_batches(node_count, edge_count, rejected_count)` | audited batch record |

Because both sides share the identical Biolink table and typing logic, the Python offline
importer and the on-demand TypeScript importer make the **same** accept/reject decision for
the same CSVs — the reject reasons are the reproducibility contract.

The public route is **`app/api/kg/import/route.ts`** (`withOrg`, **editor** role): a
`POST { nodes[], edges[] }` that calls `validateAndImportKg` and returns
`{ imported, rejected }` in the standard `ok`/`fail` envelope. No claim/source text is
logged — only ids and counts.
