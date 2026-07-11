# PaperTrail specialization of pyalex

Upstream [`pyalex`](https://github.com/J535D165/pyalex) is a general OpenAlex API
client. PaperTrail specializes it **in place** for one purpose that its living-evidence
monitor needs: measuring whether a primary source's evidence base is still *moving*.

## What we added

`pyalex/papertrail_citation_velocity.py` — **citation velocity**.

Given an OpenAlex work id (`W...`) or a DOI, it returns the number of citing
articles per year (OpenAlex `counts_by_year`), the peak year, the lifetime citation
count, and a deterministic trend label (`accelerating` / `decelerating` / `steady` /
`insufficient`) from the two most recent years.

### Why this matters for PaperTrail

A living-evidence monitor recomputes the pooled verdict when new evidence lands and
flags whether that verdict would flip. Citation velocity is a cheap, honest *signal*
of how likely new evidence is still to arrive: a flat/falling velocity means the
field has largely settled; a rising velocity means the question is still actively
contested and the pooled verdict is more likely to still flip. It is a supporting
signal on a monitor's timeline — **it never decides the verdict**; the flip verdict
is decided purely by the deterministic cumulative meta-analysis in
`lib/livingEvidence/`.

## Design constraints honored

- **Stdlib-only.** Uses only `urllib` + `json` — no `requests`, no third-party deps —
  so it runs anywhere the backend runs and can be shelled out to without installing
  the full `pyalex` package.
- **Deterministic.** No LLM. The same work yields the same per-year counts for a
  given OpenAlex snapshot; the trend label is a pure comparison of two integers.
- **Governance-safe.** Handles only OpenAlex ids/DOIs and integer counts — never
  claim, source, or patient text — so its `to_dict()` output is safe to attach to a
  monitor's event log (which stores ids/counts only).

## Usage

```bash
python -m pyalex.papertrail_citation_velocity W2741809807
python -m pyalex.papertrail_citation_velocity 10.1056/NEJMoa1911303
```

```python
from pyalex.papertrail_citation_velocity import citation_velocity

profile = citation_velocity("10.1056/NEJMoa1911303", mailto="ops@papertrail.example")
print(profile.trend, profile.peak_year)
print(profile.to_dict())
```

Upstream files are unchanged; this specialization is additive.
