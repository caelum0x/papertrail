#!/usr/bin/env python3
"""scispaCy biomedical entity linking — stdin/stdout bridge.

Bridge: lib/engines/scispacy.ts (linkEntities). Reads a JSON job on stdin
{"text": str} and emits exactly one JSON object on stdout:

  success: {"ok": true, "entities": [
      {"text", "label", "start", "end",
       "umlsCui": str|null, "canonicalName": str|null, "score": float|null}, ...]}
  handled error: {"ok": false, "error": "..."}  (exit 1)

Dep-gated: requires `scispacy` + `spacy` and a biomedical model (default
en_core_sci_sm, override with SCISPACY_MODEL). When the library or model is absent
the script emits an honest error envelope and exits 1 — never fake entities. Runs
real NER + UMLS entity linking. The input text is read from stdin only, never logged.
"""
import json
import os
import sys

DEFAULT_MODEL = "en_core_sci_sm"


def link(job):
    text = job.get("text")
    if not isinstance(text, str) or not text.strip():
        return {"ok": False, "error": "scispacy: non-empty 'text' is required"}

    try:
        import spacy
        # Importing registers the "scispacy_linker" factory with spaCy's pipeline.
        import scispacy  # noqa: F401
        from scispacy.linking import EntityLinker  # noqa: F401
    except ImportError:
        return {"ok": False, "error": "scispacy not installed; install scispacy to enable this engine"}

    model_name = os.environ.get("SCISPACY_MODEL", DEFAULT_MODEL)
    try:
        nlp = spacy.load(model_name)
    except OSError:
        return {
            "ok": False,
            "error": f"scispacy model '{model_name}' not installed; install it "
                     f"(see allenai/scispacy releases) to enable this engine",
        }

    if "scispacy_linker" not in nlp.pipe_names:
        nlp.add_pipe(
            "scispacy_linker",
            config={"resolve_abbreviations": True, "linker_name": "umls"},
        )
    linker = nlp.get_pipe("scispacy_linker")

    doc = nlp(text)
    entities = []
    for ent in doc.ents:
        umls_cui = None
        canonical_name = None
        score = None
        kb_ents = getattr(ent._, "kb_ents", None)
        if kb_ents:
            cui, top_score = kb_ents[0]
            umls_cui = cui
            score = float(top_score)
            concept = linker.kb.cui_to_entity.get(cui)
            if concept is not None:
                canonical_name = concept.canonical_name
        entities.append({
            "text": ent.text,
            "label": ent.label_,
            "start": ent.start_char,
            "end": ent.end_char,
            "umlsCui": umls_cui,
            "canonicalName": canonical_name,
            "score": score,
        })

    return {"ok": True, "entities": entities}


def main():
    try:
        raw = sys.stdin.read()
        job = json.loads(raw) if raw.strip() else {}
        out = link(job)
        print(json.dumps(out))
        return 0 if out.get("ok") else 1
    except Exception as exc:  # noqa: BLE001 — surface every failure as a JSON envelope
        print(json.dumps({"ok": False, "error": f"{type(exc).__name__}: {exc}"}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
