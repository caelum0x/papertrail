"""PaperTrail specialization of pyalex: CITATION VELOCITY.

A living-evidence monitor asks not only "what does the pooled evidence say" but
"is this claim's evidence base still MOVING". A blunt but honest signal of that is
citation velocity: how many new articles cite the primary source each year. A flat
or falling velocity suggests the field has settled; a rising velocity suggests the
question is still actively contested and the pooled verdict may still flip.

OpenAlex exposes this cheaply via ``cited_by_count`` per year on a work's
``counts_by_year`` field, so we do not have to page through every citing article.
This module is STDLIB-ONLY (urllib, json) so it runs anywhere the backend runs
without pulling the full pyalex/requests dependency — it is a thin, deterministic
read over the public OpenAlex API. No LLM is involved: the velocity is a pure count.

Governance: this module only ever handles OpenAlex ids/DOIs and integer counts —
never claim or patient text — so its output is safe to attach to a monitor's event
log.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from typing import Optional

OPENALEX_URL = "https://api.openalex.org"


@dataclass(frozen=True)
class YearVelocity:
    """Citing-article count for a single year."""

    year: int
    cited_by_count: int


@dataclass(frozen=True)
class CitationVelocity:
    """Citation-velocity profile for one work.

    Attributes
    ----------
    work_id:
        The resolved OpenAlex work id (e.g. ``W2741809807``).
    doi:
        The DOI if one was supplied/resolved, else ``None``.
    total_cited_by_count:
        The work's lifetime citation count as reported by OpenAlex.
    by_year:
        Per-year citing-article counts, sorted ascending by year.
    peak_year:
        The year with the highest citing-article count, or ``None`` when there is
        no per-year data.
    trend:
        Deterministic label comparing the two most recent years:
        ``"accelerating"``, ``"decelerating"``, ``"steady"``, or ``"insufficient"``.
    """

    work_id: str
    doi: Optional[str]
    total_cited_by_count: int
    by_year: list[YearVelocity] = field(default_factory=list)
    peak_year: Optional[int] = None
    trend: str = "insufficient"

    def to_dict(self) -> dict:
        """JSON-serializable form (ids/counts only — safe for a monitor event)."""
        return {
            "work_id": self.work_id,
            "doi": self.doi,
            "total_cited_by_count": self.total_cited_by_count,
            "by_year": [
                {"year": v.year, "cited_by_count": v.cited_by_count}
                for v in self.by_year
            ],
            "peak_year": self.peak_year,
            "trend": self.trend,
        }


def _normalize_identifier(identifier: str) -> str:
    """Turn a raw work id or DOI into an OpenAlex works path segment.

    Accepts an OpenAlex id (``W123``), a bare DOI (``10.1/xyz``), or a DOI URL
    (``https://doi.org/10.1/xyz``). OpenAlex resolves DOIs when prefixed
    ``doi:``.
    """
    value = identifier.strip()
    if not value:
        raise ValueError("identifier must be a non-empty work id or DOI")

    lowered = value.lower()
    if lowered.startswith("https://openalex.org/"):
        return value.rsplit("/", 1)[-1]
    if value[0] in ("W", "w") and value[1:].isdigit():
        return value.upper()
    if lowered.startswith("https://doi.org/"):
        value = value[len("https://doi.org/") :]
    if lowered.startswith("doi:"):
        value = value[len("doi:") :]
    if value.startswith("10."):
        return "doi:" + value
    # Fall back to treating it as an opaque OpenAlex id.
    return value


def _fetch_work(identifier: str, mailto: Optional[str], timeout: float) -> dict:
    """Fetch a single work from OpenAlex. Stdlib-only GET; raises on HTTP error."""
    segment = urllib.parse.quote(_normalize_identifier(identifier), safe=":")
    params = {"select": "id,doi,cited_by_count,counts_by_year"}
    if mailto:
        params["mailto"] = mailto
    url = f"{OPENALEX_URL}/works/{segment}?{urllib.parse.urlencode(params)}"

    request = urllib.request.Request(url, headers={"User-Agent": "papertrail-citation-velocity"})
    with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310 (trusted host)
        payload = response.read().decode("utf-8")
    return json.loads(payload)


def _classify_trend(by_year: list[YearVelocity]) -> str:
    """Compare the two most recent complete years to label the velocity trend."""
    if len(by_year) < 2:
        return "insufficient"
    latest = by_year[-1].cited_by_count
    previous = by_year[-2].cited_by_count
    if latest > previous:
        return "accelerating"
    if latest < previous:
        return "decelerating"
    return "steady"


def citation_velocity(
    identifier: str,
    *,
    mailto: Optional[str] = None,
    timeout: float = 15.0,
) -> CitationVelocity:
    """Compute the citation velocity (citing-articles-per-year) for a work.

    Parameters
    ----------
    identifier:
        An OpenAlex work id (``W...``) or a DOI (bare, ``doi:``-prefixed, or a
        ``https://doi.org/`` URL).
    mailto:
        Optional contact email to join OpenAlex's polite pool (recommended but
        not required).
    timeout:
        Socket timeout in seconds for the single HTTP GET.

    Returns
    -------
    CitationVelocity
        Deterministic per-year citing counts + a trend label. Pure read: the same
        work always yields the same structure for a given OpenAlex snapshot.
    """
    work = _fetch_work(identifier, mailto, timeout)

    raw_id = str(work.get("id", "")).rsplit("/", 1)[-1] or _normalize_identifier(identifier)
    doi = work.get("doi")
    total = int(work.get("cited_by_count") or 0)

    counts = work.get("counts_by_year") or []
    by_year = sorted(
        (
            YearVelocity(
                year=int(entry["year"]),
                cited_by_count=int(entry.get("cited_by_count") or 0),
            )
            for entry in counts
            if entry.get("year") is not None
        ),
        key=lambda v: v.year,
    )

    peak_year: Optional[int] = None
    if by_year:
        peak = max(by_year, key=lambda v: v.cited_by_count)
        peak_year = peak.year

    return CitationVelocity(
        work_id=raw_id,
        doi=doi,
        total_cited_by_count=total,
        by_year=by_year,
        peak_year=peak_year,
        trend=_classify_trend(by_year),
    )


if __name__ == "__main__":  # pragma: no cover - manual smoke test
    import sys

    if len(sys.argv) < 2:
        print("usage: python -m pyalex.papertrail_citation_velocity <work_id_or_doi>")
        raise SystemExit(2)

    try:
        result = citation_velocity(sys.argv[1])
    except (urllib.error.URLError, ValueError, json.JSONDecodeError) as exc:
        print(json.dumps({"error": str(exc)}))
        raise SystemExit(1) from exc

    print(json.dumps(result.to_dict(), indent=2))
