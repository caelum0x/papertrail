#!/usr/bin/env python3
# PAPERTRAIL-NATIVE ENTITY LINKER — a specialization of the scispaCy engine, owned by
# PaperTrail (this repo). See PAPERTRAIL.md in this directory.
#
# WHY THIS FILE EXISTS
# --------------------
# scispaCy's shipped pipeline is: a trained NER model tags biomedical mentions ->
# an AbbreviationDetector (Schwartz & Hearst 2003, scispacy/abbreviation.py) resolves
# short forms to long forms -> an EntityLinker (scispacy/linking.py) maps each mention
# string to a KB concept id via a KnowledgeBase (scispacy/linking_utils.py) whose two
# views are `alias_to_cuis` (surface form -> candidate ids) and `cui_to_entity`
# (id -> canonical name / aliases / type). A mention links only when a candidate clears
# a similarity threshold; otherwise it is left unlinked.
#
# PaperTrail's MOAT rule is: NO LLM in the entity-linking or numeric path. Claude is used
# only for NER (lib/entities/ner.ts) and optional prose. So this file re-implements the
# deterministic tail of that pipeline — abbreviation resolution + grounded, offset-
# preserving, deterministic entity linking — in PURE, STANDALONE Python (stdlib only), and
# specializes the KnowledgeBase toward the ontologies PaperTrail canonicalizes against:
# HGNC / UniProt (genes & proteins), ChEMBL (chemicals/drugs), EFO / DOID (diseases),
# and GO (biological processes / cellular components). It is the Python mirror of the
# TypeScript contract in lib/entities/ner.ts + lib/entities/canonicalize.ts.
#
# CONTRACT (mirrors lib/entities/ner.ts + lib/entities/canonicalize.ts)
# ---------------------------------------------------------------------
#   * Deterministic: no model calls, no network. Same input -> same output, always.
#   * OFFSET-PRESERVING: every emitted mention carries the exact [start, end) character
#     offsets of its verbatim substring in the input, so downstream grounding
#     (lib/grounding.ts locateSpan) can point at the source. A mention that cannot be
#     located verbatim is DROPPED (PaperTrail never asserts an unsourced span).
#   * Schwartz-Hearst abbreviation resolution (native port of scispacy/abbreviation.py):
#     a short-form mention links via its long form when the text defines it as
#     "long form (SHORT)".
#   * Provenance on every link: ontology + match_type (exact | abbrev | fuzzy) + score.
#   * PARALLEL resolution: each mention is resolved against the six ontologies
#     concurrently (thread pool); the best-scoring, type-consistent candidate wins.
#   * Honest miss: no candidate clears the threshold -> the mention is emitted UNLINKED
#     (curie=None, ontology=None, match_type=None, score=0.0) rather than force-fit.
#
# I/O (argparse):
#   text on stdin, or --text "..."; optional --mentions '[{"text","start","end","type"}]'
#   to link pre-extracted mentions (e.g. the output of lib/entities/ner.ts's Claude NER
#   step) instead of the built-in regex candidate finder.
#   Prints ONE JSON object to stdout:
#     {"mentions":[{"text","start","end","curie","ontology","match_type","score",
#                   "type","canonical_label","abbreviation_of","xrefs"}], ...}
#
# This file is standalone: `python papertrail_linker.py --text "..."`. It imports only the
# Python standard library so it runs with no scispaCy install and no model download. The
# directory is excluded from the Next build, so there is zero TypeScript impact.

from __future__ import annotations

import argparse
import json
import re
import sys
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Iterable, Optional

# ---------------------------------------------------------------------------
# ENTITY TYPES — the coarse buckets PaperTrail's NER emits (lib/entities/ner.ts:
# gene | disease | chemical | variant). We add "biological_process" / "cellular_component"
# for GO coverage. A concept's type constrains which mentions may link to it (a "disease"
# mention never links to a gene concept), mirroring scispaCy's specialized-NER-into-a-
# type-consistent-linker design.
# ---------------------------------------------------------------------------

EntityType = str  # one of the keys below; kept as str for stdlib-only simplicity.

GENE = "gene"
DISEASE = "disease"
CHEMICAL = "chemical"
VARIANT = "variant"
BIOLOGICAL_PROCESS = "biological_process"
CELLULAR_COMPONENT = "cellular_component"

VALID_TYPES = frozenset(
    {GENE, DISEASE, CHEMICAL, VARIANT, BIOLOGICAL_PROCESS, CELLULAR_COMPONENT}
)

# ---------------------------------------------------------------------------
# THE ONTOLOGY KNOWLEDGE BASE — a documented, in-code dictionary standing in for
# scispaCy's multi-GB downloaded KBs (which we deliberately do NOT ship). Each concept
# mirrors scispaCy's Entity NamedTuple (concept_id / canonical_name / aliases / type) and
# adds the ontology prefix + cross-references PaperTrail canonicalizes against. CURIEs are
# real ontology identifiers (HGNC:, UniProtKB:, CHEMBL, EFO:, DOID:, GO:) so a link is
# auditable against public terminologies. The linker below is data-driven: adding a
# concept needs no code change.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class OntologyConcept:
    """A single canonical ontology term. Mirrors scispaCy's Entity + PaperTrail xrefs."""

    curie: str  # e.g. "HGNC:11998", "CHEMBL25", "EFO:0000249"
    ontology: str  # e.g. "HGNC", "UniProt", "ChEMBL", "EFO", "DOID", "GO"
    canonical_label: str
    aliases: tuple[str, ...]
    term_type: EntityType
    xrefs: tuple[str, ...] = field(default_factory=tuple)


# HGNC / UniProt — genes & proteins.
_GENE_CONCEPTS: tuple[OntologyConcept, ...] = (
    OntologyConcept(
        "HGNC:11998", "HGNC", "TP53",
        ("TP53", "p53", "tumor protein p53", "TRP53", "LFS1"),
        GENE, ("UniProtKB:P04637", "Ensembl:ENSG00000141510", "NCBIGene:7157"),
    ),
    OntologyConcept(
        "HGNC:1100", "HGNC", "BRCA1",
        ("BRCA1", "breast cancer 1", "RNF53", "BRCC1"),
        GENE, ("UniProtKB:P38398", "Ensembl:ENSG00000012048", "NCBIGene:672"),
    ),
    OntologyConcept(
        "HGNC:1101", "HGNC", "BRCA2",
        ("BRCA2", "breast cancer 2", "FANCD1", "FAD1"),
        GENE, ("UniProtKB:P51587", "Ensembl:ENSG00000139618", "NCBIGene:675"),
    ),
    OntologyConcept(
        "HGNC:613", "HGNC", "APOE",
        ("APOE", "apolipoprotein E", "AD2"),
        GENE, ("UniProtKB:P02649", "Ensembl:ENSG00000130203", "NCBIGene:348"),
    ),
    OntologyConcept(
        "HGNC:3236", "HGNC", "EGFR",
        ("EGFR", "epidermal growth factor receptor", "ERBB1", "HER1"),
        GENE, ("UniProtKB:P00533", "Ensembl:ENSG00000146648", "NCBIGene:1956"),
    ),
    OntologyConcept(
        "HGNC:6407", "HGNC", "KRAS",
        ("KRAS", "K-ras", "KRAS2", "K-ras2"),
        GENE, ("UniProtKB:P01116", "Ensembl:ENSG00000133703", "NCBIGene:3845"),
    ),
    OntologyConcept(
        "HGNC:1097", "HGNC", "BRAF",
        ("BRAF", "B-raf", "BRAF1", "B-Raf proto-oncogene"),
        GENE, ("UniProtKB:P15056", "Ensembl:ENSG00000157764", "NCBIGene:673"),
    ),
    OntologyConcept(
        "HGNC:8975", "HGNC", "PCSK9",
        ("PCSK9", "proprotein convertase subtilisin/kexin type 9", "NARC1"),
        GENE, ("UniProtKB:Q8NBP7", "Ensembl:ENSG00000169174", "NCBIGene:255738"),
    ),
    OntologyConcept(
        "HGNC:6091", "HGNC", "IL6",
        ("IL6", "interleukin 6", "IL-6", "interleukin-6", "BSF2"),
        GENE, ("UniProtKB:P05231", "Ensembl:ENSG00000136244", "NCBIGene:3569"),
    ),
    OntologyConcept(
        "HGNC:11730", "HGNC", "TNF",
        ("TNF", "tumor necrosis factor", "TNF-alpha", "TNFA", "cachectin"),
        GENE, ("UniProtKB:P01375", "Ensembl:ENSG00000232810", "NCBIGene:7124"),
    ),
)

# ChEMBL — chemicals / drugs. CURIEs are ChEMBL IDs (bare, per ChEMBL convention).
_CHEMICAL_CONCEPTS: tuple[OntologyConcept, ...] = (
    OntologyConcept(
        "CHEMBL25", "ChEMBL", "Aspirin",
        ("aspirin", "acetylsalicylic acid", "ASA", "acetosal"),
        CHEMICAL, ("DrugBank:DB00945", "PubChem:2244"),
    ),
    OntologyConcept(
        "CHEMBL1431", "ChEMBL", "Metformin",
        ("metformin", "dimethylbiguanide", "glucophage"),
        CHEMICAL, ("DrugBank:DB00331", "PubChem:4091"),
    ),
    OntologyConcept(
        "CHEMBL1487", "ChEMBL", "Atorvastatin",
        ("atorvastatin", "lipitor"),
        CHEMICAL, ("DrugBank:DB01076", "PubChem:60823"),
    ),
    OntologyConcept(
        "CHEMBL1064", "ChEMBL", "Simvastatin",
        ("simvastatin", "zocor"),
        CHEMICAL, ("DrugBank:DB00641", "PubChem:54454"),
    ),
    OntologyConcept(
        "CHEMBL1464", "ChEMBL", "Warfarin",
        ("warfarin", "coumadin", "warfarin sodium"),
        CHEMICAL, ("DrugBank:DB00682", "PubChem:54678486"),
    ),
    OntologyConcept(
        "CHEMBL1503", "ChEMBL", "Omeprazole",
        ("omeprazole", "prilosec", "losec"),
        CHEMICAL, ("DrugBank:DB00338", "PubChem:4594"),
    ),
    OntologyConcept(
        "CHEMBL3560111", "ChEMBL", "Semaglutide",
        ("semaglutide", "ozempic", "wegovy", "rybelsus"),
        CHEMICAL, ("DrugBank:DB13928",),
    ),
    OntologyConcept(
        "CHEMBL1201631", "ChEMBL", "Insulin",
        ("insulin", "insulin human"),
        CHEMICAL, ("DrugBank:DB00030",),
    ),
    OntologyConcept(
        "CHEMBL3137309", "ChEMBL", "Vemurafenib",
        ("vemurafenib", "zelboraf", "PLX4032"),
        CHEMICAL, ("DrugBank:DB08881", "PubChem:42611257"),
    ),
    OntologyConcept(
        "CHEMBL1201828", "ChEMBL", "Evolocumab",
        ("evolocumab", "repatha", "AMG 145"),
        CHEMICAL, ("DrugBank:DB09303",),
    ),
)

# EFO / DOID — diseases & conditions.
_DISEASE_CONCEPTS: tuple[OntologyConcept, ...] = (
    OntologyConcept(
        "EFO:0000249", "EFO", "Alzheimer's disease",
        ("Alzheimer's disease", "Alzheimer disease", "Alzheimers", "AD",
         "Alzheimer's", "senile dementia"),
        DISEASE, ("DOID:10652", "MONDO:0004975"),
    ),
    OntologyConcept(
        "EFO:0001360", "EFO", "type 2 diabetes mellitus",
        ("type 2 diabetes mellitus", "type 2 diabetes", "T2DM", "type II diabetes",
         "diabetes mellitus type 2", "NIDDM"),
        DISEASE, ("DOID:9352", "MONDO:0005148"),
    ),
    OntologyConcept(
        "EFO:0000612", "EFO", "myocardial infarction",
        ("myocardial infarction", "heart attack", "MI", "acute myocardial infarction",
         "AMI"),
        DISEASE, ("DOID:5844", "MONDO:0005068"),
    ),
    OntologyConcept(
        "EFO:0000712", "EFO", "stroke",
        ("stroke", "cerebrovascular accident", "CVA", "cerebral infarction",
         "brain attack"),
        DISEASE, ("DOID:6713", "MONDO:0005098"),
    ),
    OntologyConcept(
        "EFO:0003144", "EFO", "heart failure",
        ("heart failure", "cardiac failure", "congestive heart failure", "CHF", "HF"),
        DISEASE, ("DOID:6000", "MONDO:0005252"),
    ),
    OntologyConcept(
        "EFO:0000311", "EFO", "cancer",
        ("cancer", "malignant neoplasm", "malignancy", "tumor", "carcinoma",
         "malignant tumor"),
        DISEASE, ("DOID:162", "MONDO:0004992"),
    ),
    OntologyConcept(
        "EFO:0000537", "EFO", "hypertension",
        ("hypertension", "high blood pressure", "HTN", "arterial hypertension"),
        DISEASE, ("DOID:10763", "MONDO:0005044"),
    ),
    OntologyConcept(
        "EFO:0003818", "EFO", "coronary artery disease",
        ("coronary artery disease", "CAD", "coronary heart disease", "CHD",
         "ischemic heart disease"),
        DISEASE, ("DOID:3393", "MONDO:0005010"),
    ),
    OntologyConcept(
        "EFO:0000384", "EFO", "Crohn's disease",
        ("Crohn's disease", "Crohn disease", "regional enteritis", "CD"),
        DISEASE, ("DOID:8778", "MONDO:0005011"),
    ),
    OntologyConcept(
        "EFO:0000685", "EFO", "rheumatoid arthritis",
        ("rheumatoid arthritis", "RA"),
        DISEASE, ("DOID:7148", "MONDO:0008383"),
    ),
)

# GO — biological processes & cellular components.
_GO_CONCEPTS: tuple[OntologyConcept, ...] = (
    OntologyConcept(
        "GO:0006915", "GO", "apoptotic process",
        ("apoptotic process", "apoptosis", "programmed cell death", "PCD",
         "type I programmed cell death"),
        BIOLOGICAL_PROCESS,
    ),
    OntologyConcept(
        "GO:0006954", "GO", "inflammatory response",
        ("inflammatory response", "inflammation"),
        BIOLOGICAL_PROCESS,
    ),
    OntologyConcept(
        "GO:0007049", "GO", "cell cycle",
        ("cell cycle", "cell division cycle"),
        BIOLOGICAL_PROCESS,
    ),
    OntologyConcept(
        "GO:0016477", "GO", "cell migration",
        ("cell migration",),
        BIOLOGICAL_PROCESS,
    ),
    OntologyConcept(
        "GO:0006914", "GO", "autophagy",
        ("autophagy", "autophagocytosis"),
        BIOLOGICAL_PROCESS,
    ),
    OntologyConcept(
        "GO:0005634", "GO", "nucleus",
        ("nucleus", "cell nucleus"),
        CELLULAR_COMPONENT,
    ),
    OntologyConcept(
        "GO:0005739", "GO", "mitochondrion",
        ("mitochondrion", "mitochondria"),
        CELLULAR_COMPONENT,
    ),
    OntologyConcept(
        "GO:0005886", "GO", "plasma membrane",
        ("plasma membrane", "cell membrane", "plasmalemma"),
        CELLULAR_COMPONENT,
    ),
)

# The six ontologies, grouped so each can be resolved in its own worker (see resolve()).
ONTOLOGY_GROUPS: dict[str, tuple[OntologyConcept, ...]] = {
    "HGNC/UniProt": _GENE_CONCEPTS,
    "ChEMBL": _CHEMICAL_CONCEPTS,
    "EFO/DOID": _DISEASE_CONCEPTS,
    "GO": _GO_CONCEPTS,
}

ALL_CONCEPTS: tuple[OntologyConcept, ...] = tuple(
    c for group in ONTOLOGY_GROUPS.values() for c in group
)


# ---------------------------------------------------------------------------
# KB INDEX — scispaCy's two views (linking_utils._index_entities):
#   alias_to_curies: normalized surface form -> concept CURIEs that use it as an alias.
#   curie_to_concept: CURIE -> the concept.
# Alias keys are normalized (lower-cased, whitespace-collapsed) so linking is
# case/spacing-insensitive, exactly as scispaCy compares normalized strings. Built ONCE.
# ---------------------------------------------------------------------------


def _normalize(surface: str) -> str:
    """Normalize a surface form: lowercase, collapse internal whitespace, trim.

    Mirrors normalizeAlias() in lib/entities/ner.ts and the normalize step documented
    in lib/entities/canonicalize.ts.
    """
    return re.sub(r"\s+", " ", surface.strip().lower())


@dataclass(frozen=True)
class _KbIndex:
    alias_to_curies: dict[str, list[str]]
    curie_to_concept: dict[str, OntologyConcept]


def _build_index(concepts: Iterable[OntologyConcept]) -> _KbIndex:
    alias_to_curies: dict[str, list[str]] = {}
    curie_to_concept: dict[str, OntologyConcept] = {}
    for concept in concepts:
        curie_to_concept[concept.curie] = concept
        for alias in {concept.canonical_label, *concept.aliases}:
            key = _normalize(alias)
            if not key:
                continue
            bucket = alias_to_curies.setdefault(key, [])
            if concept.curie not in bucket:
                bucket.append(concept.curie)
    return _KbIndex(alias_to_curies, curie_to_concept)


# One index per ontology group, so a mention can be resolved against each group in
# parallel without cross-talk, then the best candidate chosen deterministically.
_GROUP_INDEX: dict[str, _KbIndex] = {
    name: _build_index(concepts) for name, concepts in ONTOLOGY_GROUPS.items()
}


# ---------------------------------------------------------------------------
# LINKING — map a mention string to a concept within ONE ontology group. Mirrors
# linkMention() in lib/entities/ner.ts:
#   * exact normalized alias hit (type-consistent when a type is given) -> score 1.0.
#   * else best token-containment overlap over type-consistent concepts, if it clears
#     LINK_THRESHOLD (scispaCy's default 0.7).
#   * else no candidate from this group.
# ---------------------------------------------------------------------------

LINK_THRESHOLD = 0.7  # mirrors LINK_THRESHOLD in lib/entities/ner.ts


@dataclass(frozen=True)
class Candidate:
    concept: OntologyConcept
    match_type: str  # "exact" | "abbrev" | "fuzzy"
    score: float


def _overlap_score(mention_norm: str, alias_norm: str) -> float:
    """Order-free token-containment overlap in [0, 1].

    Identical to overlapScore() in lib/entities/ner.ts: the minimum of alias-coverage
    and mention-precision, so "diabetes" vs "type 2 diabetes" scores below an exact hit.
    """
    m_tokens = [t for t in mention_norm.split(" ") if t]
    a_tokens = {t for t in alias_norm.split(" ") if t}
    if not m_tokens or not a_tokens:
        return 0.0
    hits = sum(1 for t in m_tokens if t in a_tokens)
    alias_coverage = hits / len(a_tokens)
    mention_precision = hits / len(m_tokens)
    return min(alias_coverage, mention_precision)


def _link_in_group(
    index: _KbIndex,
    concepts: tuple[OntologyConcept, ...],
    mention_norm: str,
    is_abbrev_expansion: bool,
    entity_type: Optional[EntityType],
) -> Optional[Candidate]:
    """Best candidate for a normalized mention within one ontology group, or None."""
    if not mention_norm:
        return None

    # Tier 1 — exact normalized alias hit. Prefer a type-consistent concept.
    exact_curies = index.alias_to_curies.get(mention_norm)
    if exact_curies:
        typed = [
            index.curie_to_concept[c]
            for c in exact_curies
            if entity_type is None or index.curie_to_concept[c].term_type == entity_type
        ]
        chosen = typed[0] if typed else None
        if chosen is not None:
            # A hit reached via a known abbreviation's long form is provenance "abbrev";
            # a direct surface hit is "exact".
            match_type = "abbrev" if is_abbrev_expansion else "exact"
            return Candidate(chosen, match_type, 1.0)

    # Tier 2 — best fuzzy token overlap over type-consistent concepts above threshold.
    best: Optional[Candidate] = None
    for concept in concepts:
        if entity_type is not None and concept.term_type != entity_type:
            continue
        for alias in (concept.canonical_label, *concept.aliases):
            score = _overlap_score(mention_norm, _normalize(alias))
            if best is None or score > best.score:
                best = Candidate(concept, "fuzzy", score)
    if best is not None and best.score >= LINK_THRESHOLD:
        return best
    return None


def _resolve_across_ontologies(
    mention_norm: str,
    is_abbrev_expansion: bool,
    entity_type: Optional[EntityType],
    executor: ThreadPoolExecutor,
) -> Optional[Candidate]:
    """Resolve a mention against ALL six ontologies IN PARALLEL; pick the best candidate.

    Each ontology group is linked in its own worker. The winner is chosen
    deterministically: highest score, exact/abbrev before fuzzy, then a stable tie-break
    on CURIE so the same input always yields the same output.
    """
    futures = [
        executor.submit(
            _link_in_group,
            _GROUP_INDEX[name],
            concepts,
            mention_norm,
            is_abbrev_expansion,
            entity_type,
        )
        for name, concepts in ONTOLOGY_GROUPS.items()
    ]
    candidates = [f.result() for f in futures]
    ranked = [c for c in candidates if c is not None]
    if not ranked:
        return None

    # Deterministic ordering: exact/abbrev outrank fuzzy; then higher score; then a
    # stable CURIE tie-break so identical input always yields identical output.
    ranked.sort(
        key=lambda c: (
            c.match_type in ("exact", "abbrev"),
            c.score,
            c.concept.curie,
        ),
        reverse=True,
    )
    return ranked[0]


# ---------------------------------------------------------------------------
# ABBREVIATION DETECTION — a native port of scispaCy's Schwartz & Hearst (2003)
# algorithm (scispacy/abbreviation.py: find_abbreviation / short_form_filter /
# filter_matches). We scan for "long form ( SHORT )" and verify SHORT's characters match
# back-to-front against the long form, first short char starting a word. Result: short
# form -> resolved long form, so a short-form mention links via its long form (scispaCy's
# resolve_abbreviations). This mirrors findAbbreviations() in lib/entities/ner.ts.
# ---------------------------------------------------------------------------


def _match_abbreviation(long_form: str, short_form: str) -> Optional[str]:
    """Port of scispaCy find_abbreviation's char-alignment core.

    Can SHORT's characters be matched right-to-left against `long_form`, with SHORT's
    first char aligning to the start of a word? Returns the long-form substring from the
    matched start, or None.
    """
    long_index = len(long_form) - 1
    short_index = len(short_form) - 1

    while short_index >= 0:
        current_char = short_form[short_index].lower()
        if not current_char.isalnum():
            short_index -= 1
            continue
        while (long_index >= 0 and long_form[long_index].lower() != current_char) or (
            short_index == 0 and long_index > 0 and long_form[long_index - 1].isalnum()
        ):
            long_index -= 1
        if long_index < 0:
            return None
        long_index -= 1
        short_index -= 1

    long_index += 1
    # Walk back to the beginning of the word containing the matched start char.
    while long_index > 0 and not long_form[long_index - 1].isspace():
        long_index -= 1
    return long_form[long_index:].strip()


def _is_plausible_short_form(short: str) -> bool:
    """Port of scispaCy short_form_filter: 2..10 chars, >=50% alpha, first char alpha."""
    if len(short) < 2 or len(short) >= 10:
        return False
    alpha = sum(1 for c in short if c.isalpha())
    if alpha / len(short) < 0.5:
        return False
    return short[0].isalpha()


_ABBREV_RE = re.compile(r"([A-Za-z][A-Za-z0-9'\-\s]{2,120}?)\s*\(([A-Za-z][A-Za-z0-9\-]{1,9})\)")


def find_abbreviations(text: str) -> dict[str, str]:
    """Map each defined short form (lowercased) to its resolved long form.

    Mirrors findAbbreviations() in lib/entities/ner.ts: scan "long form (SHORT)", bound
    the long-form window to ~(len(short)+5) words per filter_matches, then char-align.
    """
    out: dict[str, str] = {}
    for m in _ABBREV_RE.finditer(text):
        long_candidate = m.group(1).strip()
        short = m.group(2).strip()
        if not _is_plausible_short_form(short):
            continue
        key = short.lower()
        if key in out:
            continue
        words = long_candidate.split()
        max_words = min(len(short) + 5, len(short) * 2)
        windowed = " ".join(words[max(0, len(words) - max_words):])
        resolved = _match_abbreviation(windowed, short)
        if resolved and len(resolved) > len(short):
            out[key] = resolved
    return out


# ---------------------------------------------------------------------------
# CANDIDATE MENTION FINDER — when no pre-extracted mentions are supplied (i.e. no upstream
# Claude NER), we still need offset-preserving candidates. scispaCy uses a trained NER
# model here; standalone, we generate candidates deterministically by scanning the text
# for every KB alias as a whole-word, verbatim, offset-preserving occurrence. This never
# invents a span: each candidate is a real substring at real offsets, so grounding holds.
# (When lib/entities/ner.ts drives this via --mentions, that Claude NER output is used
# instead and this finder is bypassed.)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class RawMention:
    text: str
    start: int
    end: int
    type: Optional[EntityType]  # may be None when the type is unknown upstream


def _iter_alias_occurrences(text: str) -> list[RawMention]:
    """Every whole-word, verbatim occurrence of a KB alias in `text`, with offsets."""
    mentions: list[RawMention] = []
    seen: set[tuple[int, int]] = set()
    # Longest aliases first so "type 2 diabetes" wins over "diabetes" at the same anchor.
    alias_type: list[tuple[str, EntityType]] = []
    for concept in ALL_CONCEPTS:
        for alias in (concept.canonical_label, *concept.aliases):
            alias_type.append((alias, concept.term_type))
    alias_type.sort(key=lambda at: len(at[0]), reverse=True)

    for alias, term_type in alias_type:
        pattern = re.compile(r"(?<![A-Za-z0-9])" + re.escape(alias) + r"(?![A-Za-z0-9])")
        for m in pattern.finditer(text):
            span = (m.start(), m.end())
            # Skip if this span overlaps an already-claimed (longer) mention.
            if any(not (span[1] <= s or span[0] >= e) for s, e in seen):
                continue
            seen.add(span)
            mentions.append(RawMention(m.group(0), m.start(), m.end(), term_type))
    mentions.sort(key=lambda x: (x.start, x.end))
    return mentions


# ---------------------------------------------------------------------------
# GROUNDING — the trust invariant. Every emitted mention's text MUST be the verbatim
# substring at [start, end) of the input. We re-derive the text from the offsets (never
# trust a caller-supplied text field) and drop any mention whose offsets don't point at a
# real substring. Mirrors locateSpan / the "drop ungroundable" rule in lib/grounding.ts.
# ---------------------------------------------------------------------------


def _ground(mention: RawMention, text: str) -> Optional[RawMention]:
    """Confirm the mention's offsets point at a real substring; return the verbatim one.

    If explicit offsets are out of range, fall back to locating the mention text verbatim
    (exact, then whitespace-normalized) so caller offsets that are slightly off still
    ground — but the emitted text/offsets are always the located verbatim substring.
    """
    start, end = mention.start, mention.end
    if 0 <= start < end <= len(text):
        located = text[start:end]
        if mention.text == "" or located == mention.text:
            return RawMention(located, start, end, mention.type)
        # Offsets valid but text disagrees: trust the offsets (verbatim wins).
        return RawMention(located, start, end, mention.type)

    # No usable offsets — locate the text verbatim, exact first.
    needle = mention.text.strip()
    if not needle:
        return None
    idx = text.find(needle)
    if idx != -1:
        return RawMention(needle, idx, idx + len(needle), mention.type)
    # Whitespace-normalized fallback: recover the exact original substring.
    norm_text, offsets = _normalize_with_offsets(text)
    norm_needle = re.sub(r"\s+", " ", needle)
    n_idx = norm_text.find(norm_needle)
    if n_idx == -1:
        return None
    o_start = offsets[n_idx]
    o_end = offsets[n_idx + len(norm_needle) - 1] + 1
    return RawMention(text[o_start:o_end], o_start, o_end, mention.type)


def _normalize_with_offsets(text: str) -> tuple[str, list[int]]:
    """Whitespace-collapsed copy of `text` + a map back to original char offsets.

    Mirrors normalizeWithOffsets() in lib/grounding.ts.
    """
    normalized_chars: list[str] = []
    offsets: list[int] = []
    in_ws = False
    for i, ch in enumerate(text):
        if ch.isspace():
            if not in_ws:
                normalized_chars.append(" ")
                offsets.append(i)
                in_ws = True
        else:
            normalized_chars.append(ch)
            offsets.append(i)
            in_ws = False
    return "".join(normalized_chars), offsets


# ---------------------------------------------------------------------------
# THE PIPELINE — ground candidates, resolve each across all ontologies in parallel via
# its (abbreviation-expanded) surface form, attach provenance. Deterministic throughout.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class LinkedMention:
    text: str
    start: int
    end: int
    type: Optional[EntityType]
    curie: Optional[str]
    ontology: Optional[str]
    match_type: Optional[str]  # "exact" | "abbrev" | "fuzzy" | None
    score: float
    canonical_label: Optional[str]
    abbreviation_of: Optional[str]
    xrefs: list[str]

    def to_dict(self) -> dict:
        return {
            "text": self.text,
            "start": self.start,
            "end": self.end,
            "type": self.type,
            "curie": self.curie,
            "ontology": self.ontology,
            "match_type": self.match_type,
            "score": round(self.score, 4),
            "canonical_label": self.canonical_label,
            "abbreviation_of": self.abbreviation_of,
            "xrefs": self.xrefs,
        }


def link_text(
    text: str,
    pre_extracted: Optional[list[RawMention]] = None,
    max_workers: int = 6,
) -> dict:
    """Link every mention in `text` to a canonical ontology CURIE, offsets preserved.

    Returns the JSON-serializable result dict. If `pre_extracted` is given (e.g. the
    Claude NER output from lib/entities/ner.ts), those mentions are grounded + linked;
    otherwise the deterministic KB alias finder supplies offset-preserving candidates.
    """
    empty = {
        "mentions": [],
        "grounding_dropped_count": 0,
        "linked_count": 0,
        "abbreviations": {},
    }
    if not text or not text.strip():
        return empty

    abbreviations = find_abbreviations(text)  # short(lower) -> long form

    raw = pre_extracted if pre_extracted is not None else _iter_alias_occurrences(text)

    # 1. Ground every candidate; drop the ungroundable (unsourced spans are never asserted).
    grounded: list[RawMention] = []
    dropped = 0
    for mention in raw:
        g = _ground(mention, text)
        if g is None:
            dropped += 1
        else:
            grounded.append(g)

    # 2. De-dup by (start, end, type) so the same span isn't linked twice.
    unique: dict[tuple[int, int, Optional[str]], RawMention] = {}
    for g in grounded:
        unique.setdefault((g.start, g.end, g.type), g)
    ordered = sorted(unique.values(), key=lambda x: (x.start, x.end))

    # 3. Resolve each mention against all six ontologies IN PARALLEL. When a mention is a
    #    known abbreviation, link on its long form (offsets still point at the short form).
    results: list[LinkedMention] = []
    with ThreadPoolExecutor(max_workers=max(1, max_workers)) as executor:
        for g in ordered:
            long_form = abbreviations.get(g.text.strip().lower())
            link_target = long_form if long_form else g.text
            candidate = _resolve_across_ontologies(
                _normalize(link_target),
                is_abbrev_expansion=long_form is not None,
                entity_type=g.type,
                executor=executor,
            )
            if candidate is None:
                results.append(
                    LinkedMention(
                        g.text, g.start, g.end, g.type,
                        None, None, None, 0.0, None,
                        long_form, [],
                    )
                )
            else:
                c = candidate.concept
                results.append(
                    LinkedMention(
                        g.text, g.start, g.end, g.type,
                        c.curie, c.ontology, candidate.match_type, candidate.score,
                        c.canonical_label, long_form, list(c.xrefs),
                    )
                )

    linked_count = sum(1 for r in results if r.curie is not None)
    return {
        "mentions": [r.to_dict() for r in results],
        "grounding_dropped_count": dropped,
        "linked_count": linked_count,
        "abbreviations": abbreviations,
    }


# ---------------------------------------------------------------------------
# CLI — text on stdin or --text; optional --mentions JSON for pre-extracted spans.
# ---------------------------------------------------------------------------


def _parse_pre_extracted(raw: str) -> list[RawMention]:
    """Parse --mentions JSON into RawMention list. Validates at the boundary."""
    data = json.loads(raw)
    if not isinstance(data, list):
        raise ValueError("--mentions must be a JSON array")
    out: list[RawMention] = []
    for item in data:
        if not isinstance(item, dict):
            raise ValueError("each mention must be a JSON object")
        text = str(item.get("text", ""))
        start = item.get("start")
        end = item.get("end")
        m_type = item.get("type")
        if m_type is not None:
            m_type = str(m_type)
            if m_type not in VALID_TYPES:
                m_type = None  # unknown type -> resolve against all ontologies
        # Offsets optional; -1 sentinel means "locate verbatim".
        s = int(start) if isinstance(start, (int, float)) else -1
        e = int(end) if isinstance(end, (int, float)) else -1
        out.append(RawMention(text, s, e, m_type))
    return out


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description=(
            "PaperTrail-native entity linker (scispaCy specialization): resolve "
            "biomedical mentions to HGNC/UniProt/ChEMBL/EFO/DOID/GO CURIEs in parallel, "
            "preserving character offsets. Deterministic, no LLM, no network."
        )
    )
    parser.add_argument("--text", type=str, default=None, help="Input text (else stdin).")
    parser.add_argument(
        "--mentions",
        type=str,
        default=None,
        help='Pre-extracted mentions as JSON: [{"text","start","end","type"}]. '
        "If omitted, the built-in deterministic KB alias finder is used.",
    )
    parser.add_argument(
        "--workers", type=int, default=6, help="Parallel ontology workers (default 6)."
    )
    args = parser.parse_args(argv)

    text = args.text if args.text is not None else sys.stdin.read()

    try:
        pre = _parse_pre_extracted(args.mentions) if args.mentions else None
    except (ValueError, json.JSONDecodeError) as exc:
        # Honest failure at the input boundary; never crash silently.
        json.dump({"error": f"invalid --mentions: {exc}"}, sys.stdout)
        sys.stdout.write("\n")
        return 2

    result = link_text(text, pre_extracted=pre, max_workers=args.workers)
    json.dump(result, sys.stdout, ensure_ascii=False)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
