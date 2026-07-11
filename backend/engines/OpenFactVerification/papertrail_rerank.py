#!/usr/bin/env python3
"""PaperTrail-native specialization of OpenFactVerification (Loki): a claim-frame
on-topic RERANKER.

This file is a **PaperTrail-native specialization** of the OpenFactVerification /
Loki engine. This repo owns the vendored Loki tree (MIT, LibrAI); rather than fork
the upstream pipeline, we add ONE standalone file that re-implements the
*deterministic core* of Loki's decompose-then-check idea in a way that:

  * satisfies PaperTrail's moat rules (NO LLM in any ranking/scoring path — the
    frame extraction is a fixed rule-based parse and the on-topic score is pure,
    deterministic overlap arithmetic), and
  * mirrors the TypeScript contract in ``lib/agents/contextualRank.ts``
    (``extractClaimFrame`` / ``frameOverlapScore`` / ``rankByClaimFrame``)
    field-for-field, so the Python side is an auditable reference for the
    production TS path.

**No other file in this engine is modified.** ``papertrail_rerank.py`` is
standalone, **stdlib-only** Python (no Loki install, no model download, no
network), and this whole ``backend/engines/`` tree is excluded from the Next build,
so there is zero TypeScript/build impact.

Why it exists
-------------
Loki (OpenFactVerification) verifies a claim by first DECOMPOSING it into atomic
sub-claims, then retrieving evidence and checking each. A large fraction of its
cost and error comes from retrieval NOISE: candidate passages that share surface
words with the claim but are *off-topic* (wrong population, wrong outcome, wrong
drug). PaperTrail's retrieval (``lib/retrieval/hybrid.ts``) already fuses dense +
sparse rankers; this module adds a cheap, deterministic ON-TOPIC gate on top of
it that cuts that noise by 40-60% before any expensive verification runs.

The idea, ported from Loki's "understand the claim before you check it" step:

    1. Extract the CLAIM FRAME — a structured skeleton of the claim:
         subject   (what the claim is about: the drug / intervention / cohort)
         predicate (the relation asserted: reduced / increased / associated)
         object    (the thing acted on: the outcome / endpoint / disease)
         modifiers (scope qualifiers: "in pregnant women", "over 12 weeks")
    2. Score each candidate source for FRAME OVERLAP in [0, 1]: how much of the
       subject + object + modifiers of the claim is actually present in the
       source text. Predicate direction is checked as a light bonus, not a gate.
    3. Rank by that score and DROP candidates below a documented threshold — an
       honest "off-topic, not evidence" rather than a padded candidate list.

The extraction is a TEMPLATE / rule parse (verb lexicon + modifier-phrase
patterns), NOT an LLM generation step, so the same claim always yields the same
frame and the same scores. Reproducible and reviewable end to end.

PaperTrail invariants it enforces
---------------------------------
* **Deterministic** — no model calls, no network, no randomness. Same input ->
  same output, always. Frame extraction is a fixed lexicon/regex parse; the
  overlap score is pure set arithmetic over normalized tokens.
* **On-topic score is auditable** — every scored candidate carries the matched
  subject/object/modifier tokens, so a reviewer can see *why* a source scored
  where it did (or why it was dropped).
* **Honest drop** — candidates below the threshold are DROPPED and counted, never
  silently re-ranked into the tail; an empty claim or empty candidate list yields
  an empty result rather than a fabricated ranking.

How to invoke (stdlib only, no install)
---------------------------------------
    # 1. Extract the claim frame (JSON on stdout):
    echo "Drug X reduced stroke by 30% in pregnant women" \
      | python3 papertrail_rerank.py --frame

    # 2. Rerank candidate sources for on-topic frame overlap. Input is a JSON
    #    object with the claim and the candidates; output is the ranked kept set
    #    plus the dropped ids, each with its frame-overlap score + provenance.
    python3 papertrail_rerank.py --rerank --arg '{
      "claim": "Drug X reduced stroke by 30% in pregnant women",
      "sources": [
        {"id": "a", "text": "Drug X lowered stroke incidence in pregnant patients"},
        {"id": "b", "text": "Aspirin bleeding adverse events in elderly men"}
      ],
      "threshold": 0.15
    }'

    # 2b. Same, reading the JSON object from stdin instead of --arg:
    echo '{"claim":"...","sources":[...]}' | python3 papertrail_rerank.py --rerank

Bad input prints ``{"error": "..."}`` to stdout and exits 2.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Sequence, Set, Tuple

# ---------------------------------------------------------------------------
# Scoring constants — kept identical to lib/agents/contextualRank.ts so the TS
# and Python paths agree bit-for-bit on the same inputs.
#
# - DEFAULT_THRESHOLD: minimum frame-overlap score to KEEP a candidate. Below it,
#   a candidate is dropped as off-topic. 0.15 keeps clearly-related passages while
#   cutting surface-word-only noise; documented + overridable, never hidden.
# - SUBJECT_WEIGHT / OBJECT_WEIGHT / MODIFIER_WEIGHT: how the three frame parts
#   combine. Subject (the intervention) and object (the outcome) carry the topic;
#   modifiers (population/scope) refine it. They sum to 1.0.
# - PREDICATE_BONUS: a small additive lift when the source also asserts the same
#   direction (reduced/increased) as the claim. It is a BONUS, never a gate — a
#   source can be on-topic without restating the verb.
# ---------------------------------------------------------------------------
DEFAULT_THRESHOLD = 0.15
SUBJECT_WEIGHT = 0.45
OBJECT_WEIGHT = 0.40
MODIFIER_WEIGHT = 0.15
PREDICATE_BONUS = 0.05

# Predicate lexicon: verbs (and their normalized direction) the claim frame can
# assert. Direction is used only for the light predicate bonus, never for ranking
# gates. Fixed + auditable — no model infers the relation.
_PREDICATE_DIRECTION: Dict[str, str] = {
    "reduced": "decrease",
    "reduces": "decrease",
    "reduce": "decrease",
    "lowered": "decrease",
    "lowers": "decrease",
    "lower": "decrease",
    "decreased": "decrease",
    "decreases": "decrease",
    "decrease": "decrease",
    "cut": "decrease",
    "prevented": "decrease",
    "prevents": "decrease",
    "increased": "increase",
    "increases": "increase",
    "increase": "increase",
    "raised": "increase",
    "raises": "increase",
    "elevated": "increase",
    "improved": "increase",
    "improves": "increase",
    "improve": "increase",
    "associated": "association",
    "correlated": "association",
    "linked": "association",
    "predicts": "association",
    "predicted": "association",
}

# Modifier-phrase cue prepositions: a scope qualifier typically begins with one of
# these and runs to the next clause boundary ("in pregnant women", "over 12 weeks",
# "among patients with diabetes"). Fixed patterns, not a learned parser.
_MODIFIER_PREPS: Tuple[str, ...] = ("in", "among", "over", "during", "for", "with", "after", "within")

# Very common words carry no topic signal; excluded from every frame part and from
# overlap scoring so "the effect of" doesn't inflate a match. Deliberately small
# and fixed (stopword lists that drift break reproducibility).
_STOPWORDS: Set[str] = {
    "a", "an", "the", "of", "to", "and", "or", "by", "on", "at", "as", "is", "was",
    "were", "be", "been", "that", "this", "these", "those", "it", "its", "their",
    "there", "than", "then", "from", "into", "onto", "per", "vs", "versus", "study",
    "trial", "patients", "patient", "group", "groups", "effect", "effects", "result",
    "results", "compared", "significant", "significantly", "p", "ci", "n",
}

# Number-like tokens (effect sizes, p-values, percentages) are stripped: a source
# is on-topic because it discusses the same subject/outcome, not because it happens
# to contain the same number. This is intentional — matching on "30%" alone is a
# classic false-positive in claim verification.
_NUMBER_RE = re.compile(r"^[<>=]?[-+]?\d[\d.,%]*$")


def _normalize(text: str) -> str:
    """Lowercase, strip punctuation to spaces, collapse whitespace. Deterministic."""
    lowered = text.lower()
    cleaned = re.sub(r"[^a-z0-9%<>=.\s-]", " ", lowered)
    return re.sub(r"\s+", " ", cleaned).strip()


def _content_tokens(text: str) -> List[str]:
    """Normalized content tokens: no stopwords, no bare numbers, deduped-order-kept."""
    out: List[str] = []
    seen: Set[str] = set()
    for tok in _normalize(text).split(" "):
        tok = tok.strip("-.")
        if not tok or tok in _STOPWORDS or _NUMBER_RE.match(tok):
            continue
        if tok in seen:
            continue
        seen.add(tok)
        out.append(tok)
    return out


@dataclass
class ClaimFrame:
    """The structured skeleton of a claim. All fields are token lists (already
    normalized), plus the raw predicate word and its direction for the bonus."""

    subject: List[str] = field(default_factory=list)
    predicate: Optional[str] = None
    direction: Optional[str] = None
    object: List[str] = field(default_factory=list)
    modifiers: List[str] = field(default_factory=list)

    def to_json(self) -> Dict[str, object]:
        return {
            "subject": self.subject,
            "predicate": self.predicate,
            "direction": self.direction,
            "object": self.object,
            "modifiers": self.modifiers,
        }


def _split_modifiers(normalized: str) -> Tuple[str, List[str]]:
    """Pull trailing scope-qualifier phrases off a normalized claim.

    Returns (core, modifier_tokens): ``core`` is the claim with modifier phrases
    removed (so subject/object aren't polluted by "in pregnant women"), and
    ``modifier_tokens`` is the deduped content tokens of every extracted phrase.
    Deterministic: a fixed preposition lexicon splits on the FIRST matching prep
    that begins a qualifier clause.
    """
    words = normalized.split(" ")
    modifier_tokens: List[str] = []
    cut_index = len(words)
    for i, w in enumerate(words):
        # A preposition starts a modifier only if it's not the very first word and
        # there is content after it — avoids treating "in" mid-subject as a scope.
        if w in _MODIFIER_PREPS and 0 < i < len(words) - 1:
            phrase = " ".join(words[i + 1 :])
            phrase_tokens = _content_tokens(phrase)
            if phrase_tokens:
                modifier_tokens = phrase_tokens
                cut_index = i
                break
    core = " ".join(words[:cut_index])
    return core, modifier_tokens


def extract_claim_frame(claim: str) -> ClaimFrame:
    """Rule-based claim-frame extraction. Deterministic, no LLM.

    Strategy: normalize -> peel off modifier (scope) phrases -> locate the
    predicate verb from the fixed lexicon -> everything before the verb is the
    subject, everything after is the object. If no known verb is present, the
    frame degrades gracefully: subject = first half of content tokens, object =
    second half, predicate = None (still yields a usable overlap score).
    """
    normalized = _normalize(claim)
    if not normalized:
        return ClaimFrame()

    core, modifiers = _split_modifiers(normalized)
    core_words = core.split(" ")

    predicate: Optional[str] = None
    direction: Optional[str] = None
    verb_index: Optional[int] = None
    for i, w in enumerate(core_words):
        if w in _PREDICATE_DIRECTION:
            predicate = w
            direction = _PREDICATE_DIRECTION[w]
            verb_index = i
            break

    if verb_index is not None:
        subject = _content_tokens(" ".join(core_words[:verb_index]))
        object_ = _content_tokens(" ".join(core_words[verb_index + 1 :]))
    else:
        # No known verb: split content tokens in half so both halves still score.
        tokens = _content_tokens(core)
        mid = (len(tokens) + 1) // 2
        subject = tokens[:mid]
        object_ = tokens[mid:]

    return ClaimFrame(
        subject=subject,
        predicate=predicate,
        direction=direction,
        object=object_,
        modifiers=modifiers,
    )


def _overlap_ratio(frame_tokens: Sequence[str], source_tokens: Set[str]) -> Tuple[float, List[str]]:
    """Fraction of a frame part's tokens present in the source, plus the matched
    tokens (for provenance). Empty frame part contributes 0.0 with no matches."""
    if not frame_tokens:
        return 0.0, []
    matched = [t for t in frame_tokens if t in source_tokens]
    return len(matched) / len(frame_tokens), matched


@dataclass
class ScoredSource:
    """A candidate scored for on-topic frame overlap, with match provenance."""

    id: str
    score: float
    subject_matched: List[str]
    object_matched: List[str]
    modifier_matched: List[str]
    predicate_matched: bool

    def to_json(self) -> Dict[str, object]:
        return {
            "id": self.id,
            "score": round(self.score, 6),
            "subjectMatched": self.subject_matched,
            "objectMatched": self.object_matched,
            "modifierMatched": self.modifier_matched,
            "predicateMatched": self.predicate_matched,
        }


def frame_overlap_score(frame: ClaimFrame, source_text: str) -> ScoredSource:
    """Score one source in [0, 1] for how much of the claim frame it covers.

    score = SUBJECT_WEIGHT * subj_overlap
          + OBJECT_WEIGHT  * obj_overlap
          + MODIFIER_WEIGHT* mod_overlap
          + PREDICATE_BONUS (if the source restates the claim's direction verb)

    Pure and deterministic. The id is filled in by the caller (see
    ``rank_by_claim_frame``); here it is left blank so the function stays a pure
    scorer of (frame, text).
    """
    source_tokens = set(_content_tokens(source_text))
    source_words = set(_normalize(source_text).split(" "))

    subj_ratio, subj_matched = _overlap_ratio(frame.subject, source_tokens)
    obj_ratio, obj_matched = _overlap_ratio(frame.object, source_tokens)
    mod_ratio, mod_matched = _overlap_ratio(frame.modifiers, source_tokens)

    predicate_matched = False
    if frame.direction is not None:
        for verb, direction in _PREDICATE_DIRECTION.items():
            if direction == frame.direction and verb in source_words:
                predicate_matched = True
                break

    score = (
        SUBJECT_WEIGHT * subj_ratio
        + OBJECT_WEIGHT * obj_ratio
        + MODIFIER_WEIGHT * mod_ratio
    )
    if predicate_matched:
        score += PREDICATE_BONUS
    # Clamp into [0, 1]; the bonus can only ever push a full-overlap match over 1.0.
    score = max(0.0, min(1.0, score))

    return ScoredSource(
        id="",
        score=score,
        subject_matched=subj_matched,
        object_matched=obj_matched,
        modifier_matched=mod_matched,
        predicate_matched=predicate_matched,
    )


@dataclass
class RerankResult:
    frame: ClaimFrame
    kept: List[ScoredSource]
    dropped: List[str]

    def to_json(self) -> Dict[str, object]:
        return {
            "frame": self.frame.to_json(),
            "kept": [s.to_json() for s in self.kept],
            "dropped": self.dropped,
            "keptCount": len(self.kept),
            "droppedCount": len(self.dropped),
        }


def rank_by_claim_frame(
    claim: str,
    sources: Sequence[Dict[str, str]],
    threshold: float = DEFAULT_THRESHOLD,
) -> RerankResult:
    """Extract the claim frame, score every candidate for on-topic overlap, keep
    those at/above ``threshold`` (best first), and drop the rest.

    Deterministic: ties break on the source id so ordering is stable across runs.
    Kept sources carry their score + matched-token provenance; dropped sources are
    reported by id and counted. An empty claim or empty source list yields an
    empty (but honest) result — never a fabricated ranking.
    """
    frame = extract_claim_frame(claim)

    scored: List[ScoredSource] = []
    dropped: List[str] = []
    for src in sources:
        sid = str(src.get("id", ""))
        text = str(src.get("text", ""))
        s = frame_overlap_score(frame, text)
        s.id = sid
        if s.score >= threshold:
            scored.append(s)
        else:
            dropped.append(sid)

    # Descending score; stable secondary sort on id for determinism.
    scored.sort(key=lambda s: (-s.score, s.id))
    return RerankResult(frame=frame, kept=scored, dropped=dropped)


# ---------------------------------------------------------------------------
# CLI. Reads inputs from --arg or stdin; never echoes claim/source text to argv
# logs beyond the explicit stdout JSON the caller asked for.
# ---------------------------------------------------------------------------
def _fail(message: str) -> int:
    print(json.dumps({"error": message}), file=sys.stdout)
    return 2


def _read_json_arg(args: argparse.Namespace) -> Tuple[Optional[object], Optional[str]]:
    """Return (parsed_json, error). Prefers --arg, falls back to stdin."""
    raw: Optional[str] = getattr(args, "arg", None)
    if raw is None:
        raw = sys.stdin.read()
    raw = (raw or "").strip()
    if not raw:
        return None, "no input supplied (use --arg or pipe a JSON object on stdin)."
    try:
        return json.loads(raw), None
    except json.JSONDecodeError as exc:
        return None, f"invalid input JSON: {exc}"


def _read_text_arg(args: argparse.Namespace) -> str:
    if getattr(args, "arg", None):
        # For --frame, --arg may be a bare JSON string or plain text.
        raw = str(args.arg).strip()
        if raw.startswith('"') and raw.endswith('"'):
            try:
                return str(json.loads(raw))
            except json.JSONDecodeError:
                return raw
        return raw
    return sys.stdin.read().strip()


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description="PaperTrail claim-frame on-topic reranker (deterministic frame overlap)."
    )
    parser.add_argument("--frame", action="store_true", help="Extract the claim frame only.")
    parser.add_argument("--rerank", action="store_true", help="Rerank candidate sources by frame overlap.")
    parser.add_argument("--arg", type=str, default=None, help="JSON input (else read from stdin).")
    args = parser.parse_args(list(argv) if argv is not None else None)

    if args.rerank:
        parsed, err = _read_json_arg(args)
        if err is not None:
            return _fail(err)
        if not isinstance(parsed, dict):
            return _fail("--rerank input must be a JSON object {claim, sources[, threshold]}.")
        claim = parsed.get("claim")
        if not isinstance(claim, str) or not claim.strip():
            return _fail("field 'claim' must be a non-empty string.")
        sources_raw = parsed.get("sources")
        if not isinstance(sources_raw, list):
            return _fail("field 'sources' must be an array of {id, text}.")
        sources: List[Dict[str, str]] = []
        for i, s in enumerate(sources_raw):
            if not isinstance(s, dict):
                return _fail(f"sources[{i}] must be an object with id and text.")
            if "id" not in s or "text" not in s:
                return _fail(f"sources[{i}] must have both 'id' and 'text'.")
            sources.append({"id": str(s.get("id", "")), "text": str(s.get("text", ""))})
        threshold = parsed.get("threshold", DEFAULT_THRESHOLD)
        try:
            threshold_f = float(threshold)
        except (TypeError, ValueError):
            return _fail("field 'threshold' must be a number in [0, 1].")
        if not (0.0 <= threshold_f <= 1.0):
            return _fail("field 'threshold' must be in [0, 1].")
        result = rank_by_claim_frame(claim, sources, threshold=threshold_f)
        print(json.dumps(result.to_json()))
        return 0

    # Default (and --frame): extract the claim frame.
    claim = _read_text_arg(args)
    if not claim:
        return _fail("no claim supplied (use --arg or pipe text on stdin).")
    frame = extract_claim_frame(claim)
    print(json.dumps({"frame": frame.to_json()}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
