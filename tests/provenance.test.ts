import { describe, it, expect } from "vitest";
import {
  buildProvenanceChain,
  verifyChain,
  evidenceQualityScore,
  type EvidenceItem,
  type ProvenanceChain,
} from "../lib/provenance/chain";
import {
  dossierToStructured,
  dossierToText,
  type DossierInput,
} from "../lib/provenance/export";

// A small, realistic set of source-backed evidence items spanning source tiers.
const ITEMS: EvidenceItem[] = [
  {
    statement: "Drug X reduced major adverse cardiac events.",
    value: "RR 0.70 (0.58–0.85)",
    source: "PubMed PMID 12345678",
    quote: "the primary endpoint occurred in fewer patients on drug X (HR 0.70).",
  },
  {
    statement: "The pivotal trial was registered and completed.",
    value: "NCT01234567",
    source: "ClinicalTrials.gov NCT01234567",
    quote: "Status: Completed. Primary completion date reached.",
  },
  {
    statement: "Target–disease genetic association is strong.",
    value: "0.82",
    source: "Open Targets Platform",
    quote: "overall association score 0.82 for the target–disease pair.",
  },
];

describe("provenance chain", () => {
  it("builds a genesis-anchored, contiguous chain that verifies", () => {
    const chain = buildProvenanceChain(ITEMS);
    expect(chain).toHaveLength(ITEMS.length);
    expect(chain[0].prevHash).toBe("");
    expect(chain[0].index).toBe(0);
    // Each record's prevHash is the previous record's hash.
    for (let i = 1; i < chain.length; i += 1) {
      expect(chain[i].prevHash).toBe(chain[i - 1].hash);
    }
    expect(verifyChain(chain)).toBe(true);
  });

  it("is deterministic — same items in same order give identical hashes", () => {
    const a = buildProvenanceChain(ITEMS);
    const b = buildProvenanceChain(ITEMS);
    expect(a.map((r) => r.hash)).toEqual(b.map((r) => r.hash));
  });

  it("is TAMPER-EVIDENT — mutating one item's field breaks verifyChain", () => {
    const chain = buildProvenanceChain(ITEMS);
    expect(verifyChain(chain)).toBe(true);

    // Immutably clone and alter the value of the middle record's item only.
    const tampered: ProvenanceChain = chain.map((record, i) =>
      i === 1
        ? { ...record, item: { ...record.item, value: "RR 0.10 (0.05–0.20)" } }
        : record
    );
    expect(verifyChain(tampered)).toBe(false);
  });

  it("is TAMPER-EVIDENT — editing a stored hash breaks verifyChain", () => {
    const chain = buildProvenanceChain(ITEMS);
    const tampered: ProvenanceChain = chain.map((record, i) =>
      i === 2 ? { ...record, hash: "0".repeat(64) } : record
    );
    expect(verifyChain(tampered)).toBe(false);
  });

  it("is ORDER-SENSITIVE — reordering items produces a different, still-broken chain", () => {
    const chain = buildProvenanceChain(ITEMS);

    // Swap the first two ITEMS and rebuild: the new chain's hashes differ from the
    // original starting at the first swapped position.
    const reordered = [ITEMS[1], ITEMS[0], ITEMS[2]];
    const rebuilt = buildProvenanceChain(reordered);
    expect(rebuilt[0].hash).not.toBe(chain[0].hash);
    // The reordered chain is itself internally valid (rebuilt correctly)...
    expect(verifyChain(rebuilt)).toBe(true);

    // ...but if we merely reorder the ORIGINAL records without re-hashing (an
    // attacker splicing the audit log), verifyChain rejects it because prevHash
    // back-links and indices no longer line up.
    const splice: ProvenanceChain = [chain[1], chain[0], chain[2]];
    expect(verifyChain(splice)).toBe(false);
  });

  it("verifies a single-item (genesis-only) chain", () => {
    const chain = buildProvenanceChain([ITEMS[0]]);
    expect(chain).toHaveLength(1);
    expect(verifyChain(chain)).toBe(true);
  });

  it("verifies the empty chain vacuously", () => {
    expect(verifyChain(buildProvenanceChain([]))).toBe(true);
  });
});

describe("evidenceQualityScore", () => {
  it("scores an empty set 0", () => {
    expect(evidenceQualityScore([])).toBe(0);
  });

  it("gives a full-coverage, all-Tier-1 set the maximum score of 1", () => {
    const tier1: EvidenceItem[] = [
      { statement: "s1", value: "v1", source: "ClinicalTrials.gov NCT1", quote: "q1" },
      { statement: "s2", value: "v2", source: "FDA label", quote: "q2" },
    ];
    expect(evidenceQualityScore(tier1)).toBe(1);
  });

  it("penalizes missing coverage (unsourced / unquoted claims)", () => {
    const full: EvidenceItem[] = [
      { statement: "s1", value: "v1", source: "PubMed PMID 1", quote: "q1" },
      { statement: "s2", value: "v2", source: "PubMed PMID 2", quote: "q2" },
    ];
    const halfUnsourced: EvidenceItem[] = [
      { statement: "s1", value: "v1", source: "PubMed PMID 1", quote: "q1" },
      // no source AND no quote -> not source-backed -> drags coverage down.
      { statement: "s2", value: "v2", source: "", quote: "" },
    ];
    expect(evidenceQualityScore(halfUnsourced)).toBeLessThan(evidenceQualityScore(full));
  });

  it("rewards higher source tiers (registry > preprint)", () => {
    const registry: EvidenceItem[] = [
      { statement: "s", value: "v", source: "ClinicalTrials.gov NCT1", quote: "q" },
    ];
    const preprint: EvidenceItem[] = [
      { statement: "s", value: "v", source: "medRxiv preprint 2024", quote: "q" },
    ];
    expect(evidenceQualityScore(registry)).toBeGreaterThan(evidenceQualityScore(preprint));
  });

  it("treats an item missing its supporting quote as not source-backed", () => {
    const noQuote: EvidenceItem[] = [
      { statement: "s", value: "v", source: "ClinicalTrials.gov NCT1", quote: "   " },
    ];
    // Blank quote -> weight 0 -> coverage 0, tier 0 -> total 0.
    expect(evidenceQualityScore(noQuote)).toBe(0);
  });
});

// A minimal computed dossier feeding the submission-export layer.
const DOSSIER: DossierInput = {
  title: "PCSK9 inhibition — efficacy & safety dossier",
  generatedAt: "2026-07-10T00:00:00.000Z",
  sections: [
    {
      title: "Efficacy",
      claims: [
        {
          statement: "LDL-C lowering reduces cardiovascular events.",
          value: "RR 0.70 (0.58–0.85)",
          source: "PubMed PMID 12345678",
          quote: "cardiovascular events were reduced (RR 0.70).",
        },
        {
          statement: "The pivotal trial completed enrollment.",
          value: "NCT01234567",
          source: "ClinicalTrials.gov NCT01234567",
          quote: "Status: Completed.",
        },
      ],
    },
    {
      title: "Target rationale",
      claims: [
        {
          statement: "Genetic association supports the target.",
          value: 0.82,
          source: "Open Targets Platform",
          quote: "overall association score 0.82.",
        },
      ],
    },
  ],
};

describe("dossier export round-trip", () => {
  it("attaches a provenance hash to EVERY claim, matching the chain record", () => {
    const structured = dossierToStructured(DOSSIER);

    const allClaims = structured.sections.flatMap((s) => s.claims);
    const totalClaims = DOSSIER.sections.reduce((n, s) => n + s.claims.length, 0);
    expect(allClaims).toHaveLength(totalClaims);
    expect(structured.provenance.claimCount).toBe(totalClaims);

    // Every claim carries a non-empty 64-hex-char SHA-256 provenance hash, and it
    // equals the hash of the chain record at the claim's chainIndex.
    for (const claim of allClaims) {
      expect(claim.provenanceHash).toMatch(/^[0-9a-f]{64}$/);
      const record = structured.provenance.chain[claim.chainIndex];
      expect(record.hash).toBe(claim.provenanceHash);
    }

    // The embedded chain verifies and the flag agrees.
    expect(structured.provenance.verified).toBe(true);
    expect(verifyChain(structured.provenance.chain)).toBe(true);

    // Root hash is the terminal link.
    const chain = structured.provenance.chain;
    expect(structured.provenance.rootHash).toBe(chain[chain.length - 1].hash);
  });

  it("normalizes a numeric value into the hashed string form deterministically", () => {
    const a = dossierToStructured(DOSSIER);
    const b = dossierToStructured(DOSSIER);
    expect(a.provenance.rootHash).toBe(b.provenance.rootHash);
    // The numeric 0.82 became the string "0.82" in the structured claim.
    const targetClaim = a.sections[1].claims[0];
    expect(targetClaim.value).toBe("0.82");
  });

  it("text export contains every claim's provenance hash and the root hash", () => {
    const structured = dossierToStructured(DOSSIER);
    const text = dossierToText(DOSSIER);

    for (const section of structured.sections) {
      for (const claim of section.claims) {
        expect(text).toContain(claim.provenanceHash);
      }
    }
    expect(text).toContain(structured.provenance.rootHash);
    expect(text).toContain("VERIFIED");
  });
});
