#!/usr/bin/env python3
"""PaperQA2 grounded question answering — stdin/stdout bridge.

Bridge: lib/engines/paperqa.ts (askPaperQa). Reads a JSON job on stdin
{"question": str, "texts": [{"name": str, "text": str}],
 "llm"?, "summary_llm"?, "embedding"?, "temperature"?,
 "answer_max_sources"?, "evidence_k"?} and emits exactly one JSON object on stdout:

  success: {"ok": true, "answer": str,
            "contexts": [{"text", "name", "score": int, "summary"}, ...],
            "references": str}
  handled error: {"ok": false, "error": "..."}  (exit 1)

Dep-gated: requires `paper-qa` (pip install paper-qa) and an LLM key. When absent
the script emits an honest error envelope and exits 1 — never a fake answer. Indexes
the already-fetched source texts (no live fetch) and runs the real PaperQA2 agentic
QA pipeline. Question/source text is read from stdin only and is never logged.
"""
import json
import os
import re
import sys
import tempfile


def _build_settings(job, Settings):
    """Assemble a paper-qa Settings object from the optional tuning fields."""
    kwargs = {}
    if isinstance(job.get("llm"), str):
        kwargs["llm"] = job["llm"]
    if isinstance(job.get("summary_llm"), str):
        kwargs["summary_llm"] = job["summary_llm"]
    if isinstance(job.get("embedding"), str):
        kwargs["embedding"] = job["embedding"]
    if isinstance(job.get("temperature"), (int, float)):
        kwargs["temperature"] = float(job["temperature"])

    settings = Settings(**kwargs)
    answer_settings = settings.answer
    if isinstance(job.get("answer_max_sources"), int):
        answer_settings.answer_max_sources = job["answer_max_sources"]
    if isinstance(job.get("evidence_k"), int):
        answer_settings.evidence_k = job["evidence_k"]
    return settings


def _safe_filename(name, index):
    slug = re.sub(r"[^A-Za-z0-9._-]+", "_", name).strip("_") if isinstance(name, str) else ""
    return f"{index:03d}_{slug or 'source'}.txt"


def ask(job):
    question = job.get("question")
    texts = job.get("texts")
    if not isinstance(question, str) or not question.strip():
        return {"ok": False, "error": "paperqa: a non-empty 'question' is required"}
    if not isinstance(texts, list) or not texts:
        return {"ok": False, "error": "paperqa: a non-empty 'texts' array is required"}

    try:
        from paperqa import Docs, Settings
    except ImportError:
        return {"ok": False, "error": "paperqa not installed; install paper-qa to enable this engine"}

    settings = _build_settings(job, Settings)
    docs = Docs()

    with tempfile.TemporaryDirectory(prefix="paperqa_") as tmpdir:
        for index, src in enumerate(texts):
            if not isinstance(src, dict) or not isinstance(src.get("text"), str) or not src["text"].strip():
                continue
            name = src.get("name") if isinstance(src.get("name"), str) else f"source-{index}"
            path = os.path.join(tmpdir, _safe_filename(name, index))
            with open(path, "w", encoding="utf-8") as handle:
                handle.write(src["text"])
            docs.add(path, citation=name, docname=name, settings=settings)

        session = docs.query(question, settings=settings)

    contexts = []
    for ctx in getattr(session, "contexts", []) or []:
        inner_text = getattr(ctx, "text", None)
        passage = getattr(inner_text, "text", "") if inner_text is not None else ""
        chunk_name = getattr(inner_text, "name", "") if inner_text is not None else ""
        score = getattr(ctx, "score", -1)
        contexts.append({
            "text": passage,
            "name": chunk_name,
            "score": int(score) if isinstance(score, (int, float)) else -1,
            "summary": getattr(ctx, "context", ""),
        })

    return {
        "ok": True,
        "answer": getattr(session, "answer", "") or "",
        "contexts": contexts,
        "references": getattr(session, "references", "") or "",
    }


def main():
    try:
        raw = sys.stdin.read()
        job = json.loads(raw) if raw.strip() else {}
        out = ask(job)
        print(json.dumps(out))
        return 0 if out.get("ok") else 1
    except Exception as exc:  # noqa: BLE001 — surface every failure as a JSON envelope
        print(json.dumps({"ok": False, "error": f"{type(exc).__name__}: {exc}"}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
