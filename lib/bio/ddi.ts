// Open DRUG–DRUG-INTERACTION (DDI) signal detection derived from FAERS (openFDA).
//
// MOAT: this is a DETERMINISTIC interaction signal computed ENTIRELY from open
// FDA adverse-event report counts (openFDA / FAERS, CC0). It deliberately AVOIDS
// DrugBank and DDInter (paid / non-commercial) — we own the whole numeric path
// and it is reproducible from public data. NO LLM is ever in the numeric loop.
//
// The idea: a genuine drug–drug interaction shows up in spontaneous reports as an
// event that is disproportionately co-reported when BOTH drugs are present,
// ABOVE AND BEYOND what either drug produces on its own. So we compute three
// disproportionality analyses against the same event:
//
//   combined — the 2x2 for reports listing BOTH drugA AND drugB vs the event.
//   aAlone   — the single-drug signal for drugA vs the event.
//   bAlone   — the single-drug signal for drugB vs the event.
//
// then contrast the combined signal against each single-drug signal. If the
// combined Information Component is MATERIALLY higher than the larger of the two
// single-drug ICs (and its own 95% lower bound clears zero), we flag a possible
// synergistic interaction. Otherwise the co-report is explained by the drugs'
// individual profiles (no_excess), or there simply aren't enough co-reports to
// judge (insufficient_data).
//
// This is a HYPOTHESIS GENERATOR, exactly like single-drug disproportionality —
// never proof of a causal interaction. It is a screening signal for follow-up.
//
// Pure & immutable: every function returns a fresh object and never mutates its
// inputs. All openFDA access is confined to an INJECTABLE fetcher so the tests
// run fully offline against mocked report counts. On ANY failure we return an
// HONEST empty result (null blocks / insufficient_data), never a fabricated 2x2.

import { z } from "zod";
import {
  disproportionality,
  type Faers2x2,
  type DisproportionalityResult,
} from "./pharmacovigilance";
import type {
  InteractionVerdict,
  InteractionSignalResult,
} from "./ddi.schemas";

// ---------------------------------------------------------------------------
// Interaction contrast thresholds — DOCUMENTED and DETERMINISTIC.
// ---------------------------------------------------------------------------

// Minimum count of BOTH-drug + event co-reports to even attempt a contrast. A
// combined signal built on 1–2 reports is noise; below this we return
// insufficient_data rather than a confident verdict. Mirrors the a>=3 gate the
// single-drug MHRA rule uses.
const MIN_COMBINED_COREPORTS = 3;

// The combined signal must clear an IC gap of at least this many bits ABOVE the
// larger single-drug IC to count as "materially higher". IC is on a log2 scale,
// so +0.5 bits ≈ a ~1.4x higher observed/expected co-reporting rate than the
// stronger single drug already explains. Chosen to be conservative: we would
// rather miss a weak signal than fabricate an interaction from measurement noise.
const IC_SYNERGY_MARGIN = 0.5;

// ---------------------------------------------------------------------------
// openFDA (FAERS) fetch layer — injectable so tests stay offline.
// ---------------------------------------------------------------------------

const OPENFDA_BASE = "https://api.fda.gov";

// Bound each request so a hung upstream can never wedge a serverless invocation.
const REQUEST_TIMEOUT_MS = 12_000;

// Canonical openFDA FAERS fields: generic drug name and MedDRA reaction PT.
const DRUG_FIELD = "patient.drug.openfda.generic_name";
const EVENT_FIELD = "patient.reaction.reactionmeddrapt";
// The corpus denominator: any report that carries a reaction term at all.
const CORPUS_EXISTS = "_exists_:patient.reaction.reactionmeddrapt";

// A minimal injectable fetcher: given a fully-formed URL, return parsed JSON
// (or throw). The default hits real openFDA; tests pass a stub.
export type JsonFetcher = (url: string) => Promise<unknown>;

export interface DdiDeps {
  fetchJson: JsonFetcher;
}

const defaultFetchJson: JsonFetcher = async (url: string) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`openFDA responded ${res.status}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
};

const defaultDeps: DdiDeps = { fetchJson: defaultFetchJson };

// openFDA search terms must be quoted-and-escaped for exact phrase matching.
function faersPhrase(field: string, value: string): string {
  const escaped = value.replace(/["\\]/g, "\\$&");
  return `${field}:"${escaped}"`;
}

// Join clauses with a boolean AND. URLSearchParams percent-encodes spaces to
// %20, which openFDA accepts as `clause AND clause`. Never join with a literal
// `+` (encodes to %2B and breaks the query).
function andSearch(...clauses: string[]): string {
  return clauses.join(" AND ");
}

// A single-total count via the `limit=1` search meta (total in meta.results.total).
const MetaTotalSchema = z.object({
  meta: z
    .object({ results: z.object({ total: z.number() }).optional() })
    .optional(),
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

// ---------------------------------------------------------------------------
// 2x2 assembly. We build three tables against the SAME event, one per drug
// "presence" clause: BOTH drugs, drugA, drugB. Each is honest-null on failure.
// ---------------------------------------------------------------------------

// The "index" side of a 2x2: a clause selecting the reports of interest (a drug,
// or both drugs). We cross-tabulate that clause against the event.
//
//                 THIS event   OTHER events   row total
//   index clause       a            b           a+b
//   OTHER reports       c            d           c+d
//
// We issue four count queries:
//   nTotal = corpus size (reports carrying any reaction)   -> n
//   nIndex = reports matching the index clause             -> a+b
//   nEvent = reports mentioning THIS event                 -> a+c
//   a      = reports matching index clause AND this event
// then derive b, c, d. Refuse (null) on any transport failure or a negative
// derived cell — never fabricate a count to complete the table.
async function fetchIndex2x2(
  indexClause: string,
  eventClause: string,
  deps: DdiDeps
): Promise<Faers2x2 | null> {
  const safeTotal = async (search: string): Promise<number | null> => {
    try {
      return readTotal(await deps.fetchJson(totalUrl(search)));
    } catch {
      // openFDA answers 404 for zero-match searches, which the default fetcher
      // turns into a throw. Treat a throw as UNKNOWN, not zero, so we never
      // fabricate a table from a transport error.
      return null;
    }
  };

  const [nTotal, nIndex, nEvent, aCell] = await Promise.all([
    safeTotal(CORPUS_EXISTS),
    safeTotal(indexClause),
    safeTotal(eventClause),
    safeTotal(andSearch(indexClause, eventClause)),
  ]);

  if (nTotal === null || nIndex === null || nEvent === null || aCell === null) {
    return null;
  }

  const a = aCell;
  const b = nIndex - a;
  const c = nEvent - a;
  const d = nTotal - a - b - c;

  // Internal-consistency guard: derived cells must be non-negative and the
  // corpus non-empty. Overlapping openFDA totals could otherwise imply a
  // negative cell — we refuse rather than emit a fabricated one.
  if (b < 0 || c < 0 || d < 0 || nTotal <= 0) return null;

  return { a, b, c, d };
}

// ---------------------------------------------------------------------------
// Interaction contrast — the deterministic verdict. Documented thresholds only.
// ---------------------------------------------------------------------------

/**
 * Classify the interaction from the three disproportionality blocks.
 *
 * DETERMINISTIC rule (all from documented constants above):
 *   1. If `combined` is null or has fewer than MIN_COMBINED_COREPORTS index
 *      reports (a) -> insufficient_data.
 *   2. Otherwise take the larger of the two single-drug ICs (a null single-drug
 *      block contributes -Infinity, i.e. "no single-drug explanation"). If the
 *      combined IC exceeds that baseline by at least IC_SYNERGY_MARGIN bits AND
 *      the combined signal's own lower credibility bound (ic025) clears 0
 *      (i.e. the combined co-reporting is itself significant) -> synergistic_signal.
 *   3. Otherwise -> no_excess.
 *
 * IC (log2 observed/expected) is the right axis for the contrast because it is
 * additive on the log scale and each block's ic025 gives a built-in significance
 * gate — no LLM judgement anywhere.
 */
export function classifyInteraction(
  combined: DisproportionalityResult | null,
  aAlone: DisproportionalityResult | null,
  bAlone: DisproportionalityResult | null
): InteractionVerdict {
  if (!combined || combined.a < MIN_COMBINED_COREPORTS) {
    return "insufficient_data";
  }

  const aIc = aAlone ? aAlone.informationComponent : -Infinity;
  const bIc = bAlone ? bAlone.informationComponent : -Infinity;
  const singleBaseline = Math.max(aIc, bIc);

  const materiallyHigher =
    combined.informationComponent >= singleBaseline + IC_SYNERGY_MARGIN;
  // The combined co-reporting must itself be significant (lower IC bound > 0),
  // otherwise a large gap over two weak single-drug signals is just noise.
  const combinedSignificant = combined.ic025 > 0;

  return materiallyHigher && combinedSignificant
    ? "synergistic_signal"
    : "no_excess";
}

// ---------------------------------------------------------------------------
// interactionSignal — end-to-end assembly + contrast.
// ---------------------------------------------------------------------------

export interface InteractionInput {
  drugA: string;
  drugB: string;
  event: string;
}

/**
 * Assemble the combined and single-drug FAERS 2x2 tables for (drugA, drugB, event),
 * compute disproportionality for each, and classify the interaction.
 *
 * Returns { drugA, drugB, event, combined, aAlone, bAlone, interaction }. Any
 * block whose 2x2 couldn't be assembled (API failure / inconsistency / degenerate
 * table) is null — an HONEST empty, never a fabricated value. If the combined
 * table is missing or too sparse the verdict is `insufficient_data`.
 */
export async function interactionSignal(
  input: InteractionInput,
  deps: DdiDeps = defaultDeps
): Promise<InteractionSignalResult> {
  const drugA = typeof input.drugA === "string" ? input.drugA.trim() : "";
  const drugB = typeof input.drugB === "string" ? input.drugB.trim() : "";
  const event = typeof input.event === "string" ? input.event.trim() : "";

  const empty: InteractionSignalResult = {
    drugA,
    drugB,
    event,
    combined: null,
    aAlone: null,
    bAlone: null,
    interaction: "insufficient_data",
  };

  if (drugA.length === 0 || drugB.length === 0 || event.length === 0) {
    return empty;
  }

  const drugAClause = faersPhrase(DRUG_FIELD, drugA);
  const drugBClause = faersPhrase(DRUG_FIELD, drugB);
  const eventClause = faersPhrase(EVENT_FIELD, event);
  const bothClause = andSearch(drugAClause, drugBClause);

  // Three index clauses vs the same event. Each fetch is independent and
  // honest-null on failure, so a single bad table never poisons the others.
  const [bothCounts, aCounts, bCounts] = await Promise.all([
    fetchIndex2x2(bothClause, eventClause, deps),
    fetchIndex2x2(drugAClause, eventClause, deps),
    fetchIndex2x2(drugBClause, eventClause, deps),
  ]);

  const combined = bothCounts ? disproportionality(bothCounts) : null;
  const aAlone = aCounts ? disproportionality(aCounts) : null;
  const bAlone = bCounts ? disproportionality(bCounts) : null;

  const interaction = classifyInteraction(combined, aAlone, bAlone);

  return { drugA, drugB, event, combined, aAlone, bAlone, interaction };
}
