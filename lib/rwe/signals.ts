// Deterministic Real-World-Evidence (RWE) temporal signals over the OPEN corpus.
//
// This is the "Aetion angle" done on public data: instead of a proprietary EHR
// claims database, we derive TEMPORAL evidence trends from the three open sources
// PaperTrail already trusts — FDA FAERS (openFDA), PubMed E-utilities, and
// ClinicalTrials.gov — and turn them into deterministic signals:
//
//   adverseEventTrend  : per-year FAERS disproportionality (PRR/IC) for a
//                        (drug, event) pair, classified rising/stable/falling by
//                        an ordinary-least-squares slope over the yearly IC.
//   evidenceVolumeTrend: per-year PubMed publication counts + ClinicalTrials.gov
//                        trial starts for a topic, classified emerging/active/
//                        established by documented volume + recency thresholds.
//   rweProfile         : the two combined, with a deterministic text summary.
//
// EVERY number is a pure, closed-form computation. Claude is NEVER in the numeric
// loop. Every external call goes through an INJECTABLE deps object so the entire
// engine runs offline against mocks in tests. On any upstream failure we return an
// HONEST-EMPTY signal (null) rather than a fabricated trend.
//
// The disproportionality math is reused verbatim from lib/bio/pharmacovigilance —
// we do not re-derive PRR/IC here; we only assemble per-year 2x2 tables and feed
// them to the oracle-tested engine.

import {
  disproportionality,
  type Faers2x2,
} from "../bio/pharmacovigilance";
import {
  type AdverseEventTrend,
  type AdverseEventYear,
  type EvidenceMaturity,
  type EvidenceVolumeTrend,
  type RweProfile,
  type TrendDirection,
  type YearCount,
} from "./schemas";

// ---------------------------------------------------------------------------
// Documented deterministic thresholds
// ---------------------------------------------------------------------------

// Direction classification for the adverse-event IC trend. We fit an OLS line
// IC ~ year and read its slope (IC units per calendar year):
//   slope >  IC_SLOPE_EPS  -> "rising"   (signal strengthening over time)
//   slope < -IC_SLOPE_EPS  -> "falling"
//   otherwise              -> "stable"
// The epsilon is a small dead-band so year-to-year sampling noise around a flat
// signal doesn't get labelled as a trend. 0.05 IC/yr ≈ a 5% change in the
// observed/expected reporting ratio per year at IC≈0 — below that we call it flat.
const IC_SLOPE_EPS = 0.05;

// Evidence-maturity thresholds for evidenceVolumeTrend. `total` is publications +
// trials across all observed years; `recentShare` is the fraction of that total
// falling in the last RECENT_WINDOW_YEARS years of the observed span.
//   established: a large cumulative corpus (well-studied topic).
//   emerging  : small total but concentrated in the recent window (new + growing).
//   active    : everything in between (a body of work that is still accumulating).
const MATURITY_ESTABLISHED_TOTAL = 500;
const MATURITY_EMERGING_TOTAL = 60;
const RECENT_WINDOW_YEARS = 3;
const EMERGING_RECENT_SHARE = 0.5;

// ---------------------------------------------------------------------------
// Injectable fetch layer (default = real APIs; tests pass mocks)
// ---------------------------------------------------------------------------

// A yearly FAERS 2x2: for a given calendar year we need the same four counts the
// disproportionality engine consumes, restricted to reports RECEIVED that year.
export type YearlyFaersFetcher = (
  drug: string,
  event: string,
  year: number
) => Promise<Faers2x2 | null>;

// Yearly scalar counters for the volume trend.
export type YearlyCountFetcher = (query: string, year: number) => Promise<number | null>;

export interface AdverseEventTrendDeps {
  fetchYearly2x2: YearlyFaersFetcher;
  years: number[]; // the calendar years to sample, ascending
}

export interface EvidenceVolumeTrendDeps {
  fetchPublicationCount: YearlyCountFetcher; // PubMed hits published in `year`
  fetchTrialStartCount: YearlyCountFetcher; // CT.gov studies started in `year`
  years: number[];
}

// The default sampling window: a rolling span ending at the current year. Kept
// as a pure helper so tests can pin exact years instead of depending on the clock.
export function defaultYears(span = 6, endYear = new Date().getUTCFullYear()): number[] {
  const start = endYear - span + 1;
  const out: number[] = [];
  for (let y = start; y <= endYear; y++) out.push(y);
  return out;
}

// ---------------------------------------------------------------------------
// Deterministic helpers (pure)
// ---------------------------------------------------------------------------

// Ordinary-least-squares slope of y over x. Returns null when fewer than two
// points have finite y, or when x has zero variance (can't define a slope).
export function olsSlope(points: ReadonlyArray<{ x: number; y: number }>): number | null {
  const pts = points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  const n = pts.length;
  if (n < 2) return null;

  let sx = 0;
  let sy = 0;
  for (const p of pts) {
    sx += p.x;
    sy += p.y;
  }
  const mx = sx / n;
  const my = sy / n;

  let num = 0;
  let den = 0;
  for (const p of pts) {
    const dx = p.x - mx;
    num += dx * (p.y - my);
    den += dx * dx;
  }
  if (den === 0) return null;
  return num / den;
}

// Classify a slope into a trend direction using the documented dead-band.
export function classifyDirection(slope: number | null): TrendDirection {
  if (slope === null || !Number.isFinite(slope)) return "stable";
  if (slope > IC_SLOPE_EPS) return "rising";
  if (slope < -IC_SLOPE_EPS) return "falling";
  return "stable";
}

// Deterministic maturity classification from total volume + recency concentration.
export function classifyMaturity(
  years: ReadonlyArray<YearCount>,
  recentTotal: number
): EvidenceMaturity {
  const total = years.reduce((s, y) => s + y.count, 0);
  if (total >= MATURITY_ESTABLISHED_TOTAL) return "established";

  const recentShare = total > 0 ? recentTotal / total : 0;
  if (total <= MATURITY_EMERGING_TOTAL && recentShare >= EMERGING_RECENT_SHARE) {
    return "emerging";
  }
  return "active";
}

// Sum the counts falling in the last RECENT_WINDOW_YEARS of an ascending series.
function recentCount(series: ReadonlyArray<YearCount>): number {
  if (series.length === 0) return 0;
  const lastYear = series[series.length - 1].year;
  const cutoff = lastYear - RECENT_WINDOW_YEARS + 1;
  return series.filter((p) => p.year >= cutoff).reduce((s, p) => s + p.count, 0);
}

// ---------------------------------------------------------------------------
// adverseEventTrend
// ---------------------------------------------------------------------------

// Combine two ascending YearCount series into a merged maturity classification.
// (used internally by the volume trend; kept small + pure)

/**
 * Per-year FAERS disproportionality trend for a (drug, event) pair.
 *
 * For each sampled year we assemble the year-restricted 2x2 via the injected
 * fetcher and run the SAME oracle-tested `disproportionality` engine used by the
 * pharmacovigilance route. We then fit an OLS line to the yearly Information
 * Component (IC) and classify the slope as rising/stable/falling.
 *
 * IC is chosen as the trend variable (over PRR) because it is defined and finite
 * even for sparse years (the BCPNN log2 observed/expected ratio), which makes the
 * slope robust to the ragged year-by-year counts typical of spontaneous reports.
 *
 * A year whose 2x2 is degenerate (engine returns null) contributes its raw report
 * count but null PRR/IC, and is simply excluded from the slope fit — never
 * fabricated. If the whole request can't be sampled (no fetcher input) the caller
 * gets null upstream; here we always return a well-formed (possibly empty) trend.
 */
export async function adverseEventTrend(
  input: { drug: string; event: string },
  deps: AdverseEventTrendDeps
): Promise<AdverseEventTrend | null> {
  const drug = input.drug.trim();
  const event = input.event.trim();
  if (drug.length === 0 || event.length === 0) return null;

  const sampleYears = [...deps.years].sort((a, b) => a - b);

  const years: AdverseEventYear[] = [];
  for (const year of sampleYears) {
    let table: Faers2x2 | null = null;
    try {
      table = await deps.fetchYearly2x2(drug, event, year);
    } catch {
      table = null; // treat a transport error as an unknown year, not a zero
    }

    if (!table) {
      years.push({ year, reports: 0, prr: null, ic: null, ic025: null });
      continue;
    }

    const stats = disproportionality(table);
    years.push({
      year,
      reports: table.a,
      prr: stats ? stats.prr : null,
      ic: stats ? stats.informationComponent : null,
      ic025: stats ? stats.ic025 : null,
    });
  }

  const fitPoints = years
    .filter((y) => y.ic !== null)
    .map((y) => ({ x: y.year, y: y.ic as number }));
  const icSlope = olsSlope(fitPoints);
  const direction = classifyDirection(icSlope);
  const totalReports = years.reduce((s, y) => s + y.reports, 0);

  return { drug, event, years, icSlope, direction, totalReports };
}

// ---------------------------------------------------------------------------
// evidenceVolumeTrend
// ---------------------------------------------------------------------------

/**
 * Per-year publication + trial-start volume trend for a topic.
 *
 * PubMed hit counts (E-utilities esearch with a Date-of-Publication range) and
 * ClinicalTrials.gov study-start counts are gathered per sampled year via the
 * injected fetchers, then classified into an evidence-maturity band by the
 * documented thresholds (see MATURITY_* above). Maturity is computed on the
 * COMBINED publication+trial series so a topic driven mostly by trials (or mostly
 * by literature) is judged on its total footprint, not one channel alone.
 *
 * A year whose count can't be fetched (null) is recorded as 0 for that channel —
 * a missing count is treated as "no evidence found", which is the honest reading
 * for a search that returned nothing / failed, and never inflates the trend.
 */
export async function evidenceVolumeTrend(
  input: { topic: string },
  deps: EvidenceVolumeTrendDeps
): Promise<EvidenceVolumeTrend | null> {
  const topic = input.topic.trim();
  if (topic.length === 0) return null;

  const sampleYears = [...deps.years].sort((a, b) => a - b);

  const publications: YearCount[] = [];
  const trials: YearCount[] = [];
  for (const year of sampleYears) {
    const pub = await safeCount(deps.fetchPublicationCount, topic, year);
    const trl = await safeCount(deps.fetchTrialStartCount, topic, year);
    publications.push({ year, count: pub });
    trials.push({ year, count: trl });
  }

  // Merge the two channels by year for the maturity decision.
  const combined = mergeByYear(publications, trials);
  const maturity = classifyMaturity(combined, recentCount(combined));

  const totalPublications = publications.reduce((s, p) => s + p.count, 0);
  const totalTrials = trials.reduce((s, p) => s + p.count, 0);

  return { topic, publications, trials, totalPublications, totalTrials, maturity };
}

async function safeCount(
  fetcher: YearlyCountFetcher,
  query: string,
  year: number
): Promise<number> {
  try {
    const n = await fetcher(query, year);
    return typeof n === "number" && Number.isFinite(n) && n >= 0 ? Math.trunc(n) : 0;
  } catch {
    return 0;
  }
}

// Element-wise sum of two ascending YearCount series over the union of their years.
function mergeByYear(
  a: ReadonlyArray<YearCount>,
  b: ReadonlyArray<YearCount>
): YearCount[] {
  const byYear = new Map<number, number>();
  for (const p of a) byYear.set(p.year, (byYear.get(p.year) ?? 0) + p.count);
  for (const p of b) byYear.set(p.year, (byYear.get(p.year) ?? 0) + p.count);
  return [...byYear.entries()]
    .map(([year, count]) => ({ year, count }))
    .sort((x, y) => x.year - y.year);
}

// ---------------------------------------------------------------------------
// rweProfile — combine available signals + deterministic summary
// ---------------------------------------------------------------------------

export interface RweProfileDeps {
  adverseEvent?: AdverseEventTrendDeps;
  evidenceVolume?: EvidenceVolumeTrendDeps;
}

/**
 * Assemble whichever RWE signals the inputs + deps allow, plus a DETERMINISTIC
 * one-line summary built purely from the computed numbers (no LLM).
 *
 * - The adverse-event trend runs only when both `drug` and `event` are given AND
 *   an `adverseEvent` deps object is supplied.
 * - The volume trend runs only when `topic` is given AND `evidenceVolume` deps are
 *   supplied.
 * Any signal that isn't requested, or whose engine returns null, is reported as
 * null — honest-empty, never fabricated.
 */
export async function rweProfile(
  input: { drug?: string; topic?: string; event?: string },
  deps: RweProfileDeps
): Promise<RweProfile> {
  const drug = input.drug?.trim() || null;
  const event = input.event?.trim() || null;
  const topic = input.topic?.trim() || null;

  let ae: AdverseEventTrend | null = null;
  if (drug && event && deps.adverseEvent) {
    ae = await adverseEventTrend({ drug, event }, deps.adverseEvent);
  }

  let vol: EvidenceVolumeTrend | null = null;
  if (topic && deps.evidenceVolume) {
    vol = await evidenceVolumeTrend({ topic }, deps.evidenceVolume);
  }

  return {
    drug,
    event,
    topic,
    adverseEventTrend: ae,
    evidenceVolumeTrend: vol,
    summary: buildSummary(ae, vol),
  };
}

// A deterministic headline assembled from the trend classifications. Pure string
// formatting over already-verified numbers — this is NOT an LLM narration.
export function buildSummary(
  ae: AdverseEventTrend | null,
  vol: EvidenceVolumeTrend | null
): string {
  const parts: string[] = [];

  if (ae) {
    if (ae.totalReports === 0) {
      parts.push(
        `No FAERS reports found for ${ae.drug} + ${ae.event} in the sampled window.`
      );
    } else {
      parts.push(
        `Adverse-event disproportionality for ${ae.drug} + ${ae.event} is ${ae.direction} ` +
          `over ${ae.years.length} years (${ae.totalReports} reports).`
      );
    }
  }

  if (vol) {
    parts.push(
      `Evidence base for "${vol.topic}" is ${vol.maturity} ` +
        `(${vol.totalPublications} publications, ${vol.totalTrials} trials).`
    );
  }

  if (parts.length === 0) {
    return "No RWE signal could be computed from the supplied inputs.";
  }
  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// Default (real-API) deps builders
// ---------------------------------------------------------------------------
//
// These wire the injectable fetchers to the live open APIs. They are the ONLY
// place a network call is made, and they are constructed lazily so importing this
// module (e.g. in a test) never touches the network. Each fetcher degrades to
// null on any failure so the engines above emit honest-empty signals.

const OPENFDA_BASE = "https://api.fda.gov";
const EUTILS_BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
const CTGOV_BASE = "https://clinicaltrials.gov/api/v2/studies";

type JsonFetcher = (url: string) => Promise<unknown>;

const defaultFetchJson: JsonFetcher = async (url) => {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`upstream responded ${res.status}`);
  return res.json();
};

function faersPhrase(field: string, value: string): string {
  const escaped = value.replace(/["\\]/g, "\\$&");
  return `${field}:"${escaped}"`;
}

function faersYearRange(year: number): string {
  return `receivedate:[${year}0101 TO ${year}1231]`;
}

function readFaersTotal(json: unknown): number | null {
  const meta = (json as { meta?: { results?: { total?: unknown } } })?.meta;
  const total = meta?.results?.total;
  return typeof total === "number" ? total : null;
}

// Build a year-restricted FAERS 2x2 by issuing the same four count queries the
// pharmacovigilance layer uses, each scoped to `receivedate` within the year.
export function makeYearlyFaersFetcher(
  fetchJson: JsonFetcher = defaultFetchJson
): YearlyFaersFetcher {
  const DRUG_FIELD = "patient.drug.openfda.generic_name";
  const EVENT_FIELD = "patient.reaction.reactionmeddrapt";

  const total = async (search: string): Promise<number | null> => {
    const params = new URLSearchParams({ search, limit: "1" });
    try {
      return readFaersTotal(await fetchJson(`${OPENFDA_BASE}/drug/event.json?${params}`));
    } catch {
      return null; // 404 = zero matches, but also any transport error -> unknown
    }
  };

  return async (drug, event, year) => {
    const dq = faersPhrase(DRUG_FIELD, drug);
    const eq = faersPhrase(EVENT_FIELD, event);
    const yr = faersYearRange(year);
    const [n, nDrug, nEvent, aCell] = await Promise.all([
      total(`${yr} AND _exists_:${EVENT_FIELD}`),
      total(`${yr} AND ${dq}`),
      total(`${yr} AND ${eq}`),
      total(`${yr} AND ${dq} AND ${eq}`),
    ]);
    if (n === null || nDrug === null || nEvent === null || aCell === null) return null;

    const a = aCell;
    const b = nDrug - a;
    const c = nEvent - a;
    const d = n - a - b - c;
    if (b < 0 || c < 0 || d < 0 || n <= 0) return null;
    return { a, b, c, d };
  };
}

// PubMed publication count for a topic within a single calendar year, via the
// esearch `rettype=count`-equivalent (retmax=0 still returns esearchresult.count).
export function makeYearlyPublicationFetcher(
  fetchJson: JsonFetcher = defaultFetchJson
): YearlyCountFetcher {
  return async (topic, year) => {
    const params = new URLSearchParams({
      db: "pubmed",
      term: topic,
      retmode: "json",
      retmax: "0",
      datetype: "pdat",
      mindate: `${year}/01/01`,
      maxdate: `${year}/12/31`,
    });
    const key = process.env.NCBI_API_KEY;
    if (key) params.set("api_key", key);
    try {
      const json = await fetchJson(`${EUTILS_BASE}/esearch.fcgi?${params}`);
      const raw = (json as { esearchresult?: { count?: unknown } })?.esearchresult?.count;
      const n = Number(raw);
      return Number.isFinite(n) ? n : null;
    } catch {
      return null;
    }
  };
}

// ClinicalTrials.gov study-start count for a topic within a single calendar year,
// via the v2 API's totalCount with a StartDate range filter.
export function makeYearlyTrialFetcher(
  fetchJson: JsonFetcher = defaultFetchJson
): YearlyCountFetcher {
  return async (topic, year) => {
    const params = new URLSearchParams({
      "query.term": topic,
      "filter.advanced": `AREA[StartDate]RANGE[${year}-01-01,${year}-12-31]`,
      countTotal: "true",
      pageSize: "1",
      format: "json",
    });
    try {
      const json = await fetchJson(`${CTGOV_BASE}?${params}`);
      const raw = (json as { totalCount?: unknown })?.totalCount;
      const n = Number(raw);
      return Number.isFinite(n) ? n : null;
    } catch {
      return null;
    }
  };
}

// Assemble the default (live-API) deps for a full profile over a sampling window.
export function defaultRweDeps(years: number[] = defaultYears()): RweProfileDeps {
  return {
    adverseEvent: { fetchYearly2x2: makeYearlyFaersFetcher(), years },
    evidenceVolume: {
      fetchPublicationCount: makeYearlyPublicationFetcher(),
      fetchTrialStartCount: makeYearlyTrialFetcher(),
      years,
    },
  };
}
