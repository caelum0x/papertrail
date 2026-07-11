#!/usr/bin/env python3
"""INDRA mechanism assembly — stdin/stdout bridge.

Bridge: lib/engines/indra.ts (assembleMechanisms). Reads a JSON job on stdin
{"text"?: str, "genes"?: [str], "citation"?: str, "timeout"?: int,
 "neighbor_limit"?: int, "max_statements"?: int} and emits exactly one JSON
object on stdout:

  success: {"ok": true, "reader": "reach"|"pathway_commons",
            "statements": [
              {"type", "subj": str|null, "obj": str|null, "belief": float|null,
               "evidence": [{"source": str|null, "text": str|null, "pmid": str|null}]},
              ...]}
  handled error: {"ok": false, "error": "..."}  (exit 1)

Dep-gated: requires `indra` (pip install indra). When absent the script emits an
honest error envelope and exits 1 — never fake statements. The text path reads
mechanisms via REACH; the genes path queries Pathway Commons. Claim/source text is
read from stdin only and is never logged.
"""
import json
import sys

DEFAULT_MAX_STATEMENTS = 100


def _agent_names(stmt):
    """Best-effort (subj, obj) names from an INDRA statement's agent list."""
    try:
        agents = stmt.agent_list()
    except Exception:  # noqa: BLE001 — some statement types expose no agent_list
        agents = []
    subj = agents[0].name if len(agents) >= 1 and agents[0] is not None else None
    obj = agents[1].name if len(agents) >= 2 and agents[1] is not None else None
    return subj, obj


def _digest_statement(stmt):
    subj, obj = _agent_names(stmt)
    belief = getattr(stmt, "belief", None)
    evidence = []
    for ev in getattr(stmt, "evidence", []) or []:
        pmid = getattr(ev, "pmid", None)
        evidence.append({
            "source": getattr(ev, "source_api", None),
            "text": getattr(ev, "text", None),
            "pmid": str(pmid) if pmid is not None else None,
        })
    return {
        "type": type(stmt).__name__,
        "subj": subj,
        "obj": obj,
        "belief": float(belief) if isinstance(belief, (int, float)) else None,
        "evidence": evidence,
    }


def assemble(job):
    text = job.get("text")
    genes = job.get("genes")
    has_text = isinstance(text, str) and text.strip()
    has_genes = isinstance(genes, list) and len(genes) > 0
    if not has_text and not has_genes:
        return {"ok": False, "error": "indra: non-empty 'text' or 'genes' is required"}

    max_statements = job.get("max_statements")
    max_statements = max_statements if isinstance(max_statements, int) and max_statements > 0 else DEFAULT_MAX_STATEMENTS

    if has_text:
        try:
            from indra.sources import reach
        except ImportError:
            return {"ok": False, "error": "indra not installed; install indra to enable this engine"}

        citation = job.get("citation") if isinstance(job.get("citation"), str) else None
        timeout = job.get("timeout") if isinstance(job.get("timeout"), int) else None
        processor = reach.process_text(text, citation=citation, timeout=timeout)
        reader = "reach"
    else:
        try:
            from indra.sources import biopax
        except ImportError:
            return {"ok": False, "error": "indra not installed; install indra to enable this engine"}

        gene_names = [g for g in genes if isinstance(g, str) and g.strip()]
        neighbor_limit = job.get("neighbor_limit")
        neighbor_limit = neighbor_limit if isinstance(neighbor_limit, int) and neighbor_limit > 0 else 1
        processor = biopax.process_pc_neighborhood(gene_names, neighbor_limit=neighbor_limit)
        reader = "pathway_commons"

    statements = getattr(processor, "statements", None) or []
    digested = [_digest_statement(stmt) for stmt in statements[:max_statements]]

    return {"ok": True, "reader": reader, "statements": digested}


def main():
    try:
        raw = sys.stdin.read()
        job = json.loads(raw) if raw.strip() else {}
        out = assemble(job)
        print(json.dumps(out))
        return 0 if out.get("ok") else 1
    except Exception as exc:  # noqa: BLE001 — surface every failure as a JSON envelope
        print(json.dumps({"ok": False, "error": f"{type(exc).__name__}: {exc}"}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
