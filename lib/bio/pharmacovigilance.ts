// Deterministic pharmacovigilance signal detection on FDA FAERS (openFDA).
//
// Given the drug-event 2x2 contingency table assembled from spontaneous adverse
// event reports, this computes the classic disproportionality statistics that
// regulators (FDA/EMA/MHRA/Uppsala Monitoring Centre) use to flag a potential
// safety signal: the Proportional Reporting Ratio (PRR), the Reporting Odds Ratio
// (ROR), the Pearson/Yates chi-square, and the Bayesian Information Component (IC)
// with its lower credibility bound (IC025). Every number is a pure closed-form
// computation — NO LLM is ever in the numeric loop, and every value is oracle-
// tested against a hand-computed reference table.
//
// The 2x2 table (a "drug × event" cross-tabulation over the whole report corpus):
//
//                        THIS event      OTHER events     row total
//   THIS drug                a               b             a+b
//   OTHER drugs              c               d             c+d
//   col total              a+c             b+d            n = a+b+c+d
//
// A disproportionately high `a` — more reports of (this drug + this event) than
// the rest of the database would predict — is what a signal-detection method
// surfaces. It is a hypothesis generator, NOT proof of causation.
//
// Pure & immutable: every function returns a fresh object and never mutates its
// inputs. External network access (openFDA) is confined to fetchFaersCounts and
// goes through an INJECTABLE fetcher so tests run fully offline.

import { z } from "zod";
import { ciZ, chiSquareSurvival } from "../stats/distributions";

// The z multiplier for a two-sided 95% interval (≈ 1.959964), taken from the
// oracle-tested normal quantile rather than a magic 1.96 constant.
const Z_95 = ciZ(95);
const LN2 = Math.log(2);

// Minimum count of index reports for the MHRA/EBGM signalling rule. A PRR can be
// arbitrarily large off a single report; the a>=3 gate suppresses that noise.
const SIGNAL_MIN_REPORTS = 3;
// PRR threshold and Yates chi-square threshold for the classic combined rule
// (Evans et al. 2001, adopted by the MHRA): PRR>=2 AND a>=3 AND chi2(Yates)>=4.
const SIGNAL_PRR_THRESHOLD = 2;
const SIGNAL_CHI2_THRESHOLD = 4;

// ---------------------------------------------------------------------------
// Core numeric types
// ---------------------------------------------------------------------------

// The drug-event 2x2 counts. All four cells are non-negative report counts.
export interface Faers2x2 {
  a: number; // reports of THIS drug + THIS event
  b: number; // THIS drug + OTHER events
  c: number; // OTHER drugs + THIS event
  d: number; // OTHER drugs + OTHER events
}

export interface DisproportionalityResult {
  a: number;
  b: number;
  c: number;
  d: number;
  n: number; // total reports = a+b+c+d
  prr: number; // Proportional Reporting Ratio
  prrCiLower: number; // 95% CI (log-normal method)
  prrCiUpper: number;
  ror: number; // Reporting Odds Ratio
  rorCiLower: number; // 95% CI (log-normal method)
  rorCiUpper: number;
  chiSquared: number; // Pearson chi-square, 1 df
  chiSquaredYates: number; // Yates continuity-corrected chi-square, 1 df
  pValue: number; // upper-tail p of the Yates chi-square (1 df)
  informationComponent: number; // IC = log2( a*n / ((a+b)*(a+c)) )
  ic025: number; // lower bound of the 95% IC credibility interval
  signal: boolean; // PRR>=2 AND a>=3 AND chiSquaredYates>=4
}

/**
 * Disproportionality statistics from a drug-event 2x2 table.
 *
 * FORMULAS (all standard pharmacovigilance definitions):
 *
 *   PRR = [a/(a+b)] / [c/(c+d)]
 *     = the proportion of THIS drug's reports that are THIS event, divided by the
 *       same proportion among all OTHER drugs. PRR>1 means the event is reported
 *       disproportionately often for this drug.
 *   SE(ln PRR) = sqrt( 1/a - 1/(a+b) + 1/c - 1/(c+d) )   [delta method]
 *   95% CI(PRR) = exp( ln PRR ± z * SE(ln PRR) )
 *
 *   ROR = (a/b)/(c/d) = a*d / (b*c)   [the reporting odds ratio]
 *   SE(ln ROR) = sqrt( 1/a + 1/b + 1/c + 1/d )
 *   95% CI(ROR) = exp( ln ROR ± z * SE(ln ROR) )
 *
 *   chi^2 (Pearson, 1 df) = n * (a*d - b*c)^2 / ((a+b)(c+d)(a+c)(b+d))
 *   chi^2 (Yates, 1 df)   = n * (|a*d - b*c| - n/2)^2 / ((a+b)(c+d)(a+c)(b+d))
 *     The Yates continuity correction is the one used in the MHRA signalling rule.
 *   pValue = upper-tail P(X > chi^2_Yates) for 1 df.
 *
 *   IC (Information Component, BCPNN) = log2( a*n / ((a+b)*(a+c)) )
 *     = log2 of the observed-to-expected reporting ratio. IC>0 means observed
 *       co-reporting exceeds what independence would predict.
 *   Var(IC) ≈ (1/ln2)^2 * [ (n-a)/(a(1+n)) + (n-(a+b))/((a+b)(1+n))
 *                                           + (n-(a+c))/((a+c)(1+n)) ]
 *   IC025 = IC - z * sqrt(Var(IC))   [lower 95% credibility bound]
 *
 *   signal = PRR>=2 AND a>=3 AND chi^2_Yates>=4  (Evans et al. 2001 / MHRA)
 *
 * ZERO-CELL GUARD: if any cell is zero the log-ratios and their SEs are undefined
 * (division by zero / log 0). We apply a 0.5 continuity correction to ALL four
 * cells (the standard Haldane–Anscombe correction) ONLY for the ratio + CI
 * computations. The chi-square, IC, and signal decision are computed from the
 * RAW counts (Yates already handles sparsity; the a>=3 gate handles the rest).
 * Returns null when inputs are non-finite, negative, or the corpus is empty.
 */
export function disproportionality(counts: Faers2x2): DisproportionalityResult | null {
  const { a, b, c, d } = counts;
  if (![a, b, c, d].every((x) => Number.isFinite(x) && x >= 0)) return null;

  const n = a + b + c + d;
  if (n <= 0) return null;

  // Marginals from the RAW counts. If a full margin is zero the table is
  // degenerate (e.g. nobody reported this event at all) — no signal is definable.
  const r1 = a + b; // this drug, any event
  const r2 = c + d; // other drugs, any event
  const k1 = a + c; // this event, any drug
  const k2 = b + d; // other events, any drug
  if (r1 <= 0 || r2 <= 0 || k1 <= 0 || k2 <= 0) return null;

  // --- Ratios + CIs: apply a 0.5 correction to every cell if any is zero ---
  const zeroCell = a === 0 || b === 0 || c === 0 || d === 0;
  const cc = zeroCell ? 0.5 : 0;
  const aC = a + cc;
  const bC = b + cc;
  const cC = c + cc;
  const dC = d + cc;

  // PRR = [a/(a+b)] / [c/(c+d)]
  const prr = aC / (aC + bC) / (cC / (cC + dC));
  const seLnPrr = Math.sqrt(1 / aC - 1 / (aC + bC) + 1 / cC - 1 / (cC + dC));
  const lnPrr = Math.log(prr);
  const prrCiLower = Math.exp(lnPrr - Z_95 * seLnPrr);
  const prrCiUpper = Math.exp(lnPrr + Z_95 * seLnPrr);

  // ROR = a*d / (b*c)
  const ror = (aC * dC) / (bC * cC);
  const seLnRor = Math.sqrt(1 / aC + 1 / bC + 1 / cC + 1 / dC);
  const lnRor = Math.log(ror);
  const rorCiLower = Math.exp(lnRor - Z_95 * seLnRor);
  const rorCiUpper = Math.exp(lnRor + Z_95 * seLnRor);

  // --- Chi-square from RAW counts (n(ad-bc)^2 / product-of-margins) ---
  const denom = r1 * r2 * k1 * k2;
  const adbc = a * d - b * c;
  const chiSquared = (n * adbc * adbc) / denom;
  const yatesNumRoot = Math.max(Math.abs(adbc) - n / 2, 0); // never let Yates go negative
  const chiSquaredYates = (n * yatesNumRoot * yatesNumRoot) / denom;
  const pValue = chiSquareSurvival(chiSquaredYates, 1);

  // --- Information Component (BCPNN) from RAW counts ---
  // IC = log2( a*n / ((a+b)(a+c)) ). With a=0 the observed co-reporting is zero;
  // IC -> -Infinity, which we clamp implementations avoid by using the corrected
  // `a` only for the log argument to keep IC finite while preserving sign.
  const aIc = a > 0 ? a : 0.5;
  const informationComponent = Math.log2((aIc * n) / (r1 * k1));
  const varIc =
    (1 / (LN2 * LN2)) *
    ((n - aIc) / (aIc * (1 + n)) +
      (n - r1) / (r1 * (1 + n)) +
      (n - k1) / (k1 * (1 + n)));
  const ic025 = informationComponent - Z_95 * Math.sqrt(varIc);

  // --- Classic combined signal rule (Evans 2001 / MHRA) on RAW a + Yates ---
  const signal =
    prr >= SIGNAL_PRR_THRESHOLD &&
    a >= SIGNAL_MIN_REPORTS &&
    chiSquaredYates >= SIGNAL_CHI2_THRESHOLD;

  return {
    a,
    b,
    c,
    d,
    n,
    prr,
    prrCiLower,
    prrCiUpper,
    ror,
    rorCiLower,
    rorCiUpper,
    chiSquared,
    chiSquaredYates,
    pValue,
    informationComponent,
    ic025,
    signal,
  };
}

// ---------------------------------------------------------------------------
// openFDA (FAERS) fetch layer — injectable so tests stay offline
// ---------------------------------------------------------------------------

const OPENFDA_BASE = "https://api.fda.gov";

// A minimal injectable fetcher: given a fully-formed URL, return the parsed JSON
// (or throw). The default hits the real openFDA API; tests pass a stub.
export type JsonFetcher = (url: string) => Promise<unknown>;

export interface FaersDeps {
  fetchJson: JsonFetcher;
}

const defaultFetchJson: JsonFetcher = async (url: string) => {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`openFDA responded ${res.status}`);
  }
  return res.json();
};

const defaultDeps: FaersDeps = { fetchJson: defaultFetchJson };

// openFDA search terms must be quoted-and-escaped. We keep drug/event names as
// exact phrase matches on the relevant FAERS fields.
function faersPhrase(field: string, value: string): string {
  const escaped = value.replace(/["\\]/g, "\\$&");
  return `${field}:"${escaped}"`;
}

// Join two openFDA search clauses with a boolean AND. URLSearchParams percent-
// encodes the whole string (spaces -> %20), which openFDA accepts as `clause AND
// clause` — so we join with spaces, never a literal `+` (which would encode to
// %2B and break the query).
function andSearch(left: string, right: string): string {
  return `${left} AND ${right}`;
}

// A single-total count via the `limit=1` search meta (total is in meta.results.total).
const MetaTotalSchema = z.object({
  meta: z.object({ results: z.object({ total: z.number() }).optional() }).optional(),
});

function totalUrl(search: string): string {
  const params = new URLSearchParams({ search, limit: "1" });
  return `${OPENFDA_BASE}/drug/event.json?${params.toString()}`;
}

function readTotal(json: unknown): number | null {
  const parsed = MetaTotalSchema.safeParse(json);
  if (!parsed.success) return null;
  return parsed.data.meta?.results?.total ?? 0;
}

// The FAERS fields we query. Generic name for the drug, MedDRA preferred term for
// the reaction. These are the canonical openFDA fields for disproportionality.
const DRUG_FIELD = "patient.drug.openfda.generic_name";
const EVENT_FIELD = "patient.reaction.reactionmeddrapt";

/**
 * Assemble the drug-event 2x2 from openFDA FAERS report totals.
 *
 * We issue four count queries against /drug/event.json using the `total` meta:
 *   N     = total reports in the corpus
 *   Ndrug = reports mentioning THIS drug              -> a+b
 *   Nevent= reports mentioning THIS event             -> a+c
 *   a     = reports mentioning THIS drug AND THIS event
 * then derive b = Ndrug - a, c = Nevent - a, d = N - a - b - c.
 *
 * Every request goes through the injected fetcher so tests run offline. Returns
 * null on ANY failure or if the numbers are internally inconsistent (negative
 * derived cell) — we NEVER fabricate a count to complete the table.
 */
export async function fetchFaersCounts(
  drug: string,
  event: string,
  deps: FaersDeps = defaultDeps
): Promise<Faers2x2 | null> {
  const drugName = typeof drug === "string" ? drug.trim() : "";
  const eventName = typeof event === "string" ? event.trim() : "";
  if (drugName.length === 0 || eventName.length === 0) return null;

  const drugQ = faersPhrase(DRUG_FIELD, drugName);
  const eventQ = faersPhrase(EVENT_FIELD, eventName);

  // A missing (404 NOT_FOUND) search legitimately means zero matching reports.
  const safeTotal = async (search: string): Promise<number | null> => {
    try {
      const json = await deps.fetchJson(totalUrl(search));
      return readTotal(json);
    } catch {
      // openFDA answers 404 for zero-match searches; the default fetcher turns
      // that into a throw. Treat a throw as an unknown, not a zero, to avoid
      // fabricating a table from a transport error.
      return null;
    }
  };

  const [nTotal, nDrug, nEvent, aCell] = await Promise.all([
    safeTotal("_exists_:patient.reaction.reactionmeddrapt"),
    safeTotal(drugQ),
    safeTotal(eventQ),
    safeTotal(`${drugQ}+AND+${eventQ}`),
  ]);

  if (nTotal === null || nDrug === null || nEvent === null || aCell === null) {
    return null;
  }

  const a = aCell;
  const b = nDrug - a;
  const c = nEvent - a;
  const d = nTotal - a - b - c;

  // Internal-consistency guard: derived cells must be non-negative and the corpus
  // must be non-empty. If openFDA's totals disagree (e.g. overlapping indices)
  // we refuse rather than emit a negative or fabricated cell.
  if (b < 0 || c < 0 || d < 0 || nTotal <= 0) return null;

  return { a, b, c, d };
}

export interface SafetySignalAssessment extends DisproportionalityResult {
  drug: string;
  event: string;
}

/**
 * End-to-end: fetch the FAERS 2x2 for (drug, event) and run disproportionality.
 * Returns null if the counts can't be assembled (API failure / inconsistency) or
 * the table is degenerate — an HONEST empty result, never a fabricated number.
 */
export async function assessSafetySignal(
  drug: string,
  event: string,
  deps: FaersDeps = defaultDeps
): Promise<SafetySignalAssessment | null> {
  const counts = await fetchFaersCounts(drug, event, deps);
  if (!counts) return null;

  const result = disproportionality(counts);
  if (!result) return null;

  return { drug: drug.trim(), event: event.trim(), ...result };
}

// ---------------------------------------------------------------------------
// Request validation for the public API route
// ---------------------------------------------------------------------------

export const SafetySignalRequestSchema = z.object({
  drug: z.string().trim().min(1, "drug is required").max(200),
  event: z.string().trim().min(1, "event is required").max(200),
});

export type SafetySignalRequest = z.infer<typeof SafetySignalRequestSchema>;

// Also expose a direct 2x2 schema so the route can accept pre-assembled counts
// (deterministic, no network) — useful for reproducing a published table.
export const Faers2x2Schema = z.object({
  a: z.number().int().nonnegative(),
  b: z.number().int().nonnegative(),
  c: z.number().int().nonnegative(),
  d: z.number().int().nonnegative(),
});
