// Drug-target BIOACTIVITY / MECHANISM verification against ChEMBL (EBI).
//
// ATTRIBUTION / LICENSE: Data retrieved here comes from ChEMBL, a database of the
// European Bioinformatics Institute (EMBL-EBI), released under the Creative Commons
// Attribution-ShareAlike 3.0 Unported license (CC BY-SA 3.0). Downstream use of these
// values must attribute ChEMBL and share derivative databases under the same license.
// We surface the attribution string on every verification result so consumers see it.
//
// PaperTrail's moat is DETERMINISTIC biology on real data with NO LLM in the numeric
// loop. This module answers, for a claim like "Drug X is a 5 nM inhibitor of TARGET,
// in Phase 3": does ChEMBL's measured bioactivity and clinical phase actually SUPPORT
// that — within a documented order-of-magnitude tolerance — or is it over/understated?
// The verdict is a pure function of what ChEMBL returned; nothing is inferred by an LLM.
//
// Every network call goes through a small INJECTABLE fetcher (ChemblDeps) mirroring
// lib/bio/geneticAssociation.ts / lib/ingest/searchAndCache.ts, so the tests run fully
// offline with a mocked fetch. On any upstream failure we return an honest EMPTY /
// not_found result rather than a made-up potency — a wrong "confident" bioactivity call
// is worse than an honest "couldn't verify" (CLAUDE.md no_support_found principle).

import {
  Bioactivity,
  BioactivityVerification,
  PotencyComparison,
  PotencyType,
  POTENCY_TYPES,
  PhaseComparison,
  ResolvedMolecule,
} from "./chembl.schemas";

// --- Constants -----------------------------------------------------------------

const CHEMBL_BASE = "https://www.ebi.ac.uk/chembl/api/data";
const DEFAULT_TIMEOUT_MS = 10_000;
// Cap the activity rows we pull so a promiscuous compound can't balloon the response.
const MAX_ACTIVITIES = 100;

export const CHEMBL_ATTRIBUTION =
  "Data from ChEMBL (EMBL-EBI), CC BY-SA 3.0.";

// The order-of-magnitude tolerance for potency agreement. A claim within one order of
// magnitude (factor of 10) of the measured potency is "confirmed_within_order". This is
// the field-standard granularity at which medicinal-chemistry potencies are quoted:
// IC50/Ki values are routinely compared on a log (pIC50) scale, and a difference under
// one log unit is considered the same potency class. Beyond one order the claim is
// judged over- or understated depending on direction.
export const POTENCY_BAND_ORDERS = 1;
const POTENCY_BAND_FACTOR = 10 ** POTENCY_BAND_ORDERS; // 10x

// --- Injectable fetch layer (offline-testable) ---------------------------------

// The only side-effecting surface: a fetch-like function. Defaults to global fetch;
// tests inject a stub so no real network call is made. Mirrors GeneticDeps.
export type FetchLike = (
  url: string,
  init?: { signal?: AbortSignal }
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export interface ChemblDeps {
  fetch: FetchLike;
  timeoutMs?: number;
}

const defaultDeps: ChemblDeps = {
  fetch: (url, init) => fetch(url, init),
  timeoutMs: DEFAULT_TIMEOUT_MS,
};

// --- Small safe helpers --------------------------------------------------------

function asString(v: unknown): string | null {
  if (typeof v === "string") {
    const t = v.trim();
    return t.length > 0 ? t : null;
  }
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

function asFiniteNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim().length > 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

// Only accept a standardType that is one of the potency endpoints we compare.
function asPotencyType(v: unknown): PotencyType | null {
  const s = typeof v === "string" ? v.trim() : "";
  return (POTENCY_TYPES as readonly string[]).includes(s) ? (s as PotencyType) : null;
}

// Run a fetch with a timeout + JSON parse, converting ANY failure (network, non-2xx,
// bad JSON, abort) into null. Callers treat null as "ChEMBL returned nothing", never as
// an error to surface a fabricated verdict.
async function fetchJsonSafe(
  deps: ChemblDeps,
  url: string
): Promise<unknown | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const res = await deps.fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// --- resolveMolecule -----------------------------------------------------------

// ChEMBL's molecule search returns a `molecules` array. Read the first hit
// defensively; a missing field degrades to null rather than throwing.
function firstMolecule(payload: unknown): Record<string, unknown> | null {
  const root = asRecord(payload);
  const molecules = asArray(root?.molecules);
  if (molecules.length === 0) return null;
  return asRecord(molecules[0]);
}

/**
 * Resolve a drug NAME to its ChEMBL identity: chembl_id + pref_name + max_phase.
 * Uses the ChEMBL molecule search endpoint (search=<name>). Returns an honest empty
 * ResolvedMolecule (chemblId null) when the name doesn't resolve or the API is down —
 * never a fabricated id. Offline-testable via injected deps.fetch.
 */
export async function resolveMolecule(
  name: string,
  deps: ChemblDeps = defaultDeps
): Promise<ResolvedMolecule> {
  const queryName = typeof name === "string" ? name.trim() : "";
  const empty: ResolvedMolecule = {
    queryName,
    chemblId: null,
    prefName: null,
    maxPhase: null,
  };
  if (queryName.length === 0) return empty;

  const url = `${CHEMBL_BASE}/molecule/search?q=${encodeURIComponent(
    queryName
  )}&format=json&limit=1`;
  const payload = await fetchJsonSafe(deps, url);
  if (payload === null) return empty;

  const mol = firstMolecule(payload);
  if (!mol) return empty;

  return {
    queryName,
    chemblId: asString(mol.molecule_chembl_id),
    prefName: asString(mol.pref_name),
    // max_phase can be reported as a number or a numeric string; keep it as a number
    // or null (never coerce a missing phase to 0, which would be a fabricated claim).
    maxPhase: asFiniteNumber(mol.max_phase),
  };
}

// --- targetBioactivities -------------------------------------------------------

// Normalize one ChEMBL /activity row into a Bioactivity. Target name/id can appear
// as flat fields or nested; we read the common flat fields defensively.
function normalizeActivity(raw: unknown): Bioactivity {
  const a = asRecord(raw) ?? {};
  return {
    targetChemblId: asString(a.target_chembl_id),
    targetName: asString(a.target_pref_name),
    standardType: asPotencyType(a.standard_type),
    standardValue: asFiniteNumber(a.standard_value),
    standardUnits: asString(a.standard_units),
    pChembl: asFiniteNumber(a.pchembl_value),
  };
}

/**
 * Fetch bioactivity measurements for a molecule (by ChEMBL id) from ChEMBL /activity.
 * Returns normalized records — or an empty array when nothing is found / the API is
 * unavailable (never a fabricated activity). We keep only the potency endpoints
 * (IC50/Ki/Kd/EC50) with a usable numeric value; other assay types are dropped since
 * they are not comparable to a claimed nM potency. Offline-testable via deps.fetch.
 */
export async function targetBioactivities(
  chemblId: string,
  deps: ChemblDeps = defaultDeps
): Promise<Bioactivity[]> {
  const id = typeof chemblId === "string" ? chemblId.trim() : "";
  if (id.length === 0) return [];

  const url =
    `${CHEMBL_BASE}/activity?molecule_chembl_id=${encodeURIComponent(id)}` +
    `&format=json&limit=${MAX_ACTIVITIES}`;
  const payload = await fetchJsonSafe(deps, url);
  if (payload === null) return [];

  const rows = asArray(asRecord(payload)?.activities);
  return rows
    .slice(0, MAX_ACTIVITIES)
    .map(normalizeActivity)
    .filter((b) => b.standardType !== null && b.standardValue !== null);
}

// --- Deterministic verdict logic -----------------------------------------------

// Case-insensitive substring match, either direction — used to match a claimed target
// against a returned activity's target name/id. Deliberately permissive because target
// names are free text ("Serine/threonine-protein kinase B-raf" vs "BRAF"). When either
// side is missing we do NOT match (can't claim target-specificity on a blank).
function textMatches(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  const x = a.toLowerCase();
  const y = b.trim().toLowerCase();
  if (y.length === 0) return false;
  return x.includes(y) || y.includes(x);
}

// Filter the activities to those against a claimed target (if any). With no target
// claim we consider all measured potencies (the most-potent overall stands in for the
// drug's headline potency).
function activitiesForTarget(
  activities: Bioactivity[],
  target: string | null
): Bioactivity[] {
  if (!target) return activities;
  return activities.filter(
    (a) => textMatches(a.targetName, target) || textMatches(a.targetChemblId, target)
  );
}

// The most-potent comparable measurement = the smallest standardValue (nM) among the
// relevant activities. Lower nM = more potent, so the smallest is the drug's best-case
// potency, which is the fairest thing to test a claimed potency against. Returns null
// when there is no comparable measurement (honest not_found).
function mostPotent(activities: Bioactivity[]): Bioactivity | null {
  let best: Bioactivity | null = null;
  for (const a of activities) {
    if (a.standardValue === null || a.standardValue <= 0) continue;
    if (best === null || a.standardValue < (best.standardValue as number)) best = a;
  }
  return best;
}

/**
 * Compare a claimed potency (nM) against the measured potency using a documented
 * ORDER-OF-MAGNITUDE band. Let ratio = claimed / measured:
 *   - ratio within [1/10, 10]  → confirmed_within_order (same potency class)
 *   - ratio < 1/10 (claimed << measured, i.e. claim says far MORE potent than measured)
 *                              → overstated
 *   - ratio > 10   (claimed >> measured, i.e. claim says far LESS potent than measured)
 *                              → understated
 *   - no comparable measurement or no claim → not_found
 *
 * Rationale for the direction: a SMALLER nM value means MORE potent. So a claimed
 * potency far below the measured value asserts the drug is much more potent than ChEMBL
 * shows — an OVERSTATEMENT of potency. This is a pure numeric comparison; NO LLM.
 */
export function comparePotency(
  claimedNM: number | null | undefined,
  measured: Bioactivity | null
): PotencyComparison {
  const claimed =
    typeof claimedNM === "number" && Number.isFinite(claimedNM) && claimedNM > 0
      ? claimedNM
      : null;
  const measuredNM = measured?.standardValue ?? null;
  const standardType = measured?.standardType ?? null;

  if (claimed === null || measuredNM === null || measuredNM <= 0) {
    return {
      verdict: "not_found",
      claimedNM: claimed,
      measuredNM,
      ratio: null,
      bandOrders: POTENCY_BAND_ORDERS,
      standardType,
    };
  }

  const ratio = claimed / measuredNM;
  let verdict: PotencyComparison["verdict"];
  if (ratio >= 1 / POTENCY_BAND_FACTOR && ratio <= POTENCY_BAND_FACTOR) {
    verdict = "confirmed_within_order";
  } else if (ratio < 1 / POTENCY_BAND_FACTOR) {
    // Claimed potency is far below measured → claim asserts far MORE potent → overstated.
    verdict = "overstated";
  } else {
    // Claimed potency is far above measured → claim asserts far LESS potent → understated.
    verdict = "understated";
  }

  return {
    verdict,
    claimedNM: claimed,
    measuredNM,
    ratio,
    bandOrders: POTENCY_BAND_ORDERS,
    standardType,
  };
}

/**
 * Compare a claimed clinical phase against ChEMBL's max_phase.
 *   - claimed === max_phase → confirmed
 *   - claimed  >  max_phase → overstated (claim says the drug is further along than
 *                             ChEMBL records — the dangerous direction for a claim)
 *   - claimed  <  max_phase → understated
 *   - no claim or no max_phase → not_found
 * Pure integer comparison; NO LLM.
 */
export function comparePhase(
  claimedPhase: number | null | undefined,
  chemblMaxPhase: number | null
): PhaseComparison {
  const claimed =
    typeof claimedPhase === "number" && Number.isFinite(claimedPhase)
      ? claimedPhase
      : null;

  if (claimed === null || chemblMaxPhase === null) {
    return { verdict: "not_found", claimedPhase: claimed, chemblMaxPhase };
  }

  let verdict: PhaseComparison["verdict"];
  if (claimed === chemblMaxPhase) verdict = "confirmed";
  else if (claimed > chemblMaxPhase) verdict = "overstated";
  else verdict = "understated";

  return { verdict, claimedPhase: claimed, chemblMaxPhase };
}

// Deterministic mechanism check: does the claimed target/mechanism substring-match any
// returned activity's target? This is a string containment test, NOT an LLM judgement.
function classifyMechanism(
  claimedMechanism: string | null,
  target: string | null,
  activities: Bioactivity[]
): { verdict: "consistent" | "unverified" | "not_claimed"; matchedTarget: string | null } {
  const claim = claimedMechanism?.trim() || null;
  if (!claim && !target) {
    return { verdict: "not_claimed", matchedTarget: null };
  }
  // If nothing was claimed on the mechanism axis but a target was, treat the target as
  // the thing to confirm. Either the mechanism text or the target name may match.
  const needles = [claim, target].filter((x): x is string => Boolean(x));
  for (const a of activities) {
    for (const needle of needles) {
      if (textMatches(a.targetName, needle) || textMatches(a.targetChemblId, needle)) {
        return { verdict: "consistent", matchedTarget: a.targetName ?? a.targetChemblId };
      }
    }
  }
  return { verdict: "unverified", matchedTarget: null };
}

function buildRationale(
  potency: PotencyComparison,
  phase: PhaseComparison,
  mechanism: { verdict: string }
): string {
  const parts: string[] = [];

  switch (potency.verdict) {
    case "confirmed_within_order":
      parts.push(
        `Claimed potency ${potency.claimedNM} nM agrees with the measured ${potency.standardType ?? "potency"} of ${potency.measuredNM} nM within one order of magnitude.`
      );
      break;
    case "overstated":
      parts.push(
        `Claimed potency ${potency.claimedNM} nM is more than 10x stronger than the measured ${potency.standardType ?? "potency"} of ${potency.measuredNM} nM — potency overstated.`
      );
      break;
    case "understated":
      parts.push(
        `Claimed potency ${potency.claimedNM} nM is more than 10x weaker than the measured ${potency.standardType ?? "potency"} of ${potency.measuredNM} nM — potency understated.`
      );
      break;
    case "not_found":
      parts.push(
        potency.claimedNM === null
          ? "No potency was claimed."
          : "No comparable ChEMBL potency measurement was found for this drug/target."
      );
      break;
  }

  switch (phase.verdict) {
    case "confirmed":
      parts.push(`Claimed phase ${phase.claimedPhase} matches ChEMBL max_phase ${phase.chemblMaxPhase}.`);
      break;
    case "overstated":
      parts.push(`Claimed phase ${phase.claimedPhase} exceeds ChEMBL max_phase ${phase.chemblMaxPhase} — phase overstated.`);
      break;
    case "understated":
      parts.push(`Claimed phase ${phase.claimedPhase} is below ChEMBL max_phase ${phase.chemblMaxPhase} — phase understated.`);
      break;
    case "not_found":
      if (phase.claimedPhase !== null) parts.push("ChEMBL reports no max_phase to compare the claimed phase against.");
      break;
  }

  if (mechanism.verdict === "consistent") {
    parts.push("The claimed target/mechanism matches a target with measured bioactivity in ChEMBL.");
  } else if (mechanism.verdict === "unverified") {
    parts.push("The claimed target/mechanism did not match any target ChEMBL reports bioactivity against for this drug.");
  }

  return parts.join(" ");
}

/**
 * Classify a bioactivity claim DETERMINISTICALLY from resolved ChEMBL data. This is the
 * pure decision core — no network, no LLM. Given the resolved molecule, the returned
 * activities, and the claim, it produces the three independent verdicts + rationale.
 * Exposed separately so the test-suite can lock the band logic offline.
 */
export function classifyBioactivity(input: {
  drug: string;
  molecule: ResolvedMolecule;
  target?: string;
  claimedPotencyNM?: number;
  claimedMechanism?: string;
  claimedPhase?: number;
  activities: Bioactivity[];
}): BioactivityVerification {
  const target = input.target?.trim() || null;
  const claimedMechanism = input.claimedMechanism?.trim() || null;

  const relevant = activitiesForTarget(input.activities, target);
  const measured = mostPotent(relevant);

  const potency = comparePotency(input.claimedPotencyNM, measured);
  const phase = comparePhase(input.claimedPhase, input.molecule.maxPhase);
  const mech = classifyMechanism(claimedMechanism, target, input.activities);

  const rationale = buildRationale(potency, phase, mech);

  return {
    drug: input.drug,
    molecule: input.molecule,
    target,
    potency,
    phase,
    mechanism: {
      verdict: mech.verdict,
      claimedMechanism,
      matchedTarget: mech.matchedTarget,
    },
    // Surface the target-relevant activities (or all when no target claimed), capped.
    supporting: relevant.slice(0, 25),
    rationale,
    attribution: CHEMBL_ATTRIBUTION,
  };
}

/**
 * End-to-end drug-target bioactivity verification: resolve the drug to its ChEMBL id,
 * fetch its measured bioactivities, then classify the claim deterministically. If the
 * drug doesn't resolve, we still return an honest verification (molecule chemblId null,
 * every arm not_found) rather than throwing — a wrong "confident" answer is worse than
 * an honest "couldn't verify." Offline-testable via injected deps.fetch.
 */
export async function verifyBioactivityClaim(
  claim: {
    drug: string;
    target?: string;
    claimedPotencyNM?: number;
    claimedMechanism?: string;
    claimedPhase?: number;
  },
  deps: ChemblDeps = defaultDeps
): Promise<BioactivityVerification> {
  const drug = claim.drug.trim();

  const molecule = await resolveMolecule(drug, deps);

  // No resolved id → no activities to fetch. Classify against an empty set so each arm
  // degrades to an honest not_found rather than a fabricated match.
  const activities = molecule.chemblId
    ? await targetBioactivities(molecule.chemblId, deps).catch(() => [] as Bioactivity[])
    : [];

  return classifyBioactivity({
    drug,
    molecule,
    target: claim.target,
    claimedPotencyNM: claim.claimedPotencyNM,
    claimedMechanism: claim.claimedMechanism,
    claimedPhase: claim.claimedPhase,
    activities,
  });
}
