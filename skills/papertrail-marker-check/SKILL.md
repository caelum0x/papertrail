---
name: papertrail-marker-check
description: Check whether a gene is a documented marker of a cell type (and its direction — positive/negative) against PaperTrail's curated cell-marker panels, returning the matching panels with their source. Use when a scientist claims "GENE marks CELL-TYPE" (e.g. "CD19 marks B cells") and wants it confirmed against real marker-panel references rather than model recall.
---

# PaperTrail: Marker Check

Check a claimed cell-type marker — "does GENE mark CELL-TYPE, and in which
direction?" — against PaperTrail's curated `cell_marker_panels`. Returns the
matching panels (cell type, gene, direction, tissue, source, PMID) so a marker
claim traces back to a real reference, never model recall.

## Hard guarantees (state these to the user)

- **Deterministic lookup** — the match is an exact, parameterized query against
  curated marker panels. No LLM decides membership; same inputs, same panels.
- **Grounded in real panels** — every returned membership carries its `source`
  (and `pmid` where available), so a marker call traces to a curated reference.
- **Honest absence** — if no panel documents the gene↔cell-type pair, the result
  says so plainly rather than asserting a marker relationship that isn't curated.

## Step 1 — Call the tool

Preferred: the **`check_marker_panel`** MCP tool (PaperTrail connector).

Inputs (provide at least a `gene` or a `cellType`):
- `gene` (string, optional) — gene symbol, e.g. `"CD19"`.
- `cellType` (string, optional) — cell-type label, e.g. `"B cell"`.
- `direction` (string, optional) — `"positive"` or `"negative"` to scope to
  marker directionality.

Give both `gene` and `cellType` to confirm a specific "GENE marks CELL-TYPE"
claim; give one alone to enumerate the documented panels for it.

## Step 2 — Read the result

Report which panels matched: the cell type, gene symbol, direction
(positive/negative), tissue where present, and each panel's `source` / `pmid`.
If no panel matched, say the pairing is not documented in the curated panels
rather than inferring it.

## curl fallback (no MCP connector installed)

Base URL: `https://papertrail-topaz-phi.vercel.app`. No API key required.

```bash
curl -sS -X POST https://papertrail-topaz-phi.vercel.app/api/bio/marker-check \
  -H 'Content-Type: application/json' \
  -d '{ "gene": "CD19", "cellType": "B cell" }'
```

Returns the standard `{ success, data, error }` envelope; the matching panels
live under `data`.

## Notes

- Use standard gene symbols and common cell-type labels for the cleanest match.
- Absence of a curated panel is not evidence against the marker — it means the
  pairing is not in PaperTrail's curated set. State this distinction.
