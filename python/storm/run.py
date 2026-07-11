#!/usr/bin/env python3
"""STORM long-form cited synthesis — stdin/stdout bridge.

Bridge: lib/engines/storm.ts (generateStormArticle). Reads a JSON job on stdin
{"topic": str, "sources": [{"title"?, "url"?, "text"?, "snippets"?, "description"?}]}
and emits exactly one JSON object on stdout:

  success: {"ok": true, "outline": [str, ...], "article": str,
            "citations": [{"title": str, "url": str}, ...]}
  handled error: {"ok": false, "error": "..."}  (exit 1)

Dep-gated: requires `knowledge-storm` (pip install knowledge-storm) and an Anthropic
key. When absent the script emits an honest error envelope and exits 1 — never a fake
article. STORM is pointed at PaperTrail's own pre-vetted sources via a custom retrieval
module so the synthesis stays inside PaperTrail's evidence boundary. Topic/source text
is read from stdin only and is never logged.
"""
import json
import os
import sys
import tempfile

DEFAULT_MODEL = "anthropic/claude-3-5-sonnet-20241022"


def _digest_sources(sources):
    """Normalize caller sources into STORM's {url,title,description,snippets} shape."""
    digested = []
    for index, src in enumerate(sources):
        if not isinstance(src, dict):
            continue
        url = src.get("url") or f"papertrail://source/{index}"
        title = src.get("title") or url
        text = src.get("text") if isinstance(src.get("text"), str) else ""
        snippets = src.get("snippets")
        if not isinstance(snippets, list) or not snippets:
            snippets = [text] if text else []
        snippets = [s for s in snippets if isinstance(s, str) and s]
        description = src.get("description")
        if not isinstance(description, str) or not description:
            description = snippets[0] if snippets else title
        digested.append({
            "url": url,
            "title": title,
            "description": description,
            "snippets": snippets or [title],
        })
    return digested


def _read_first(directory, filenames):
    """Return the contents of the first existing file among filenames (walking dir)."""
    for root, _dirs, files in os.walk(directory):
        for candidate in filenames:
            if candidate in files:
                with open(os.path.join(root, candidate), encoding="utf-8") as handle:
                    return handle.read()
    return ""


def _parse_outline(outline_text):
    outline = []
    for line in outline_text.splitlines():
        stripped = line.strip()
        if stripped.startswith("#"):
            heading = stripped.lstrip("#").strip()
            if heading:
                outline.append(heading)
    return outline


def _parse_citations(directory):
    for root, _dirs, files in os.walk(directory):
        if "url_to_info.json" in files:
            with open(os.path.join(root, "url_to_info.json"), encoding="utf-8") as handle:
                data = json.load(handle)
            info = data.get("url_to_info", data) if isinstance(data, dict) else {}
            citations = []
            if isinstance(info, dict):
                for url, meta in info.items():
                    title = meta.get("title") if isinstance(meta, dict) else None
                    citations.append({"title": title or url, "url": url})
            return citations
    return []


def synthesize(job):
    topic = job.get("topic")
    if not isinstance(topic, str) or not topic.strip():
        return {"ok": False, "error": "storm: a non-empty 'topic' is required"}

    sources = job.get("sources")
    sources = sources if isinstance(sources, list) else []
    digested_sources = _digest_sources(sources)
    if not digested_sources:
        return {"ok": False, "error": "storm: at least one usable source is required"}

    try:
        import dspy
        from knowledge_storm import (
            STORMWikiLMConfigs,
            STORMWikiRunner,
            STORMWikiRunnerArguments,
        )
        from knowledge_storm.lm import LitellmModel
    except ImportError:
        return {"ok": False, "error": "knowledge-storm not installed; install knowledge-storm to enable this engine"}

    class CachedSourceRM(dspy.Retrieve):
        """Retrieval module that returns PaperTrail's pre-vetted sources only.

        STORM dedupes returned results by url, so returning the full pre-vetted set
        for every query keeps the synthesis strictly inside the evidence boundary.
        """

        def __init__(self, prevetted, k):
            super().__init__(k=k)
            self._prevetted = prevetted

        def forward(self, query_or_queries, exclude_urls=None):  # noqa: ARG002
            excluded = set(exclude_urls or [])
            return [row for row in self._prevetted if row["url"] not in excluded]

    model_name = os.environ.get("STORM_MODEL", DEFAULT_MODEL)
    lm_configs = STORMWikiLMConfigs()
    lm = LitellmModel(model=model_name, max_tokens=2000)
    lm_configs.set_conv_simulator_lm(lm)
    lm_configs.set_question_asker_lm(lm)
    lm_configs.set_outline_gen_lm(lm)
    lm_configs.set_article_gen_lm(lm)
    lm_configs.set_article_polish_lm(lm)

    with tempfile.TemporaryDirectory(prefix="storm_") as tmpdir:
        engine_args = STORMWikiRunnerArguments(
            output_dir=tmpdir,
            max_conv_turn=2,
            max_perspective=2,
            search_top_k=len(digested_sources),
            max_thread_num=1,
        )
        retriever = CachedSourceRM(digested_sources, k=len(digested_sources))
        runner = STORMWikiRunner(engine_args, lm_configs, retriever)

        runner.run(
            topic=topic,
            do_research=True,
            do_generate_outline=True,
            do_generate_article=True,
            do_polish_article=True,
        )
        runner.post_run()

        article = _read_first(
            tmpdir,
            ["storm_gen_article_polished.txt", "storm_gen_article.txt"],
        )
        outline_text = _read_first(tmpdir, ["storm_gen_outline.txt"])
        citations = _parse_citations(tmpdir)

    return {
        "ok": True,
        "outline": _parse_outline(outline_text),
        "article": article,
        "citations": citations,
    }


def main():
    try:
        raw = sys.stdin.read()
        job = json.loads(raw) if raw.strip() else {}
        out = synthesize(job)
        print(json.dumps(out))
        return 0 if out.get("ok") else 1
    except Exception as exc:  # noqa: BLE001 — surface every failure as a JSON envelope
        print(json.dumps({"ok": False, "error": f"{type(exc).__name__}: {exc}"}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
