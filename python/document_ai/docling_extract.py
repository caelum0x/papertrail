#!/usr/bin/env python3
"""Docling-based scholarly PDF extraction (MIT-licensed Docling, merged in-repo).

Converts a research paper PDF into structured Markdown + plain text + per-section
content, emitted as JSON on stdout. Invoked DIRECTLY as a subprocess by the Node
app (lib/ingestion/docling.ts) — no HTTP service. Docling recovers reading order,
sections, tables, and figures far better than raw pdf.js text, which matters when
processing hundreds of pages of papers and locating exact claim/finding spans.

Usage: python3 docling_extract.py <pdf_path>
Requires: pip install -r python/requirements.txt
"""
import json
import sys


def extract(pdf_path: str) -> dict:
    from docling.document_converter import DocumentConverter

    converter = DocumentConverter()
    result = converter.convert(pdf_path)
    doc = result.document

    markdown = doc.export_to_markdown()
    try:
        text = doc.export_to_text()
    except Exception:
        text = markdown

    # Per-section text when the document model exposes it (best-effort).
    sections = []
    for item, _level in getattr(doc, "iterate_items", lambda: [])():
        label = getattr(item, "label", None)
        content = getattr(item, "text", None)
        if content:
            sections.append({"label": str(label) if label else None, "text": content})

    return {
        "ok": True,
        "markdown": markdown,
        "text": text,
        "sections": sections,
        "num_pages": getattr(doc, "num_pages", None),
    }


def main() -> int:
    if len(sys.argv) < 2:
        print(json.dumps({"ok": False, "error": "usage: docling_extract.py <pdf_path>"}))
        return 2
    try:
        out = extract(sys.argv[1])
        print(json.dumps(out))
        return 0
    except Exception as exc:  # noqa: BLE001 — surface any failure to the Node caller as JSON
        print(json.dumps({"ok": False, "error": f"{type(exc).__name__}: {exc}"}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
