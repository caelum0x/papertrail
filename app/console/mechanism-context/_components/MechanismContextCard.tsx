import type { ContextedMechanismStatement, MechanismContext } from "./types";

// One context-tagged mechanism card. The mechanism triple + deterministic belief lead;
// beneath it the resolved biological context (tissue / species / assay) and the
// deterministic translation-confidence score. Every context value is backed by a grounded
// verbatim quote — the tags are shown so a reviewer can check the source substring behind
// each tag, never an ungrounded assertion.

const RELATION_LABEL: Record<ContextedMechanismStatement["relation"], string> = {
  activates: "activates",
  inhibits: "inhibits",
  phosphorylates: "phosphorylates",
  binds: "binds",
  regulates: "regulates",
};

const SPECIES_LABEL: Record<NonNullable<MechanismContext["species"]>, string> = {
  human: "Human",
  mouse: "Mouse",
  rat: "Rat",
  "in-vitro": "In vitro",
};

const ASSAY_LABEL: Record<NonNullable<MechanismContext["assay"]>, string> = {
  "in-vivo": "In vivo",
  "in-vitro": "In vitro",
  "cell-line": "Cell line",
};

// Confidence buckets for the deterministic translation score — thresholds only drive the
// color/label, never the score itself (which is computed server-side).
function confidenceTone(score: number): { label: string; className: string } {
  if (score >= 0.8) return { label: "High", className: "bg-emerald-50 text-emerald-800" };
  if (score >= 0.45) return { label: "Moderate", className: "bg-amber-50 text-amber-800" };
  return { label: "Low", className: "bg-red-50 text-red-700" };
}

function ContextChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-1 text-xs">
      <span className="font-medium uppercase tracking-wide text-ink/40">{label}</span>
      <span className="font-mono text-ink/70">{value}</span>
    </div>
  );
}

interface MechanismContextCardProps {
  statement: ContextedMechanismStatement;
}

export function MechanismContextCard({ statement }: MechanismContextCardProps) {
  const { context } = statement;
  const humanInVivo = context.species === "human" && context.assay === "in-vivo";
  const tone = confidenceTone(statement.translationConfidence);

  return (
    <div className="rounded-lg border border-ink/15 bg-white p-4">
      {/* Mechanism triple + belief */}
      <div className="flex items-start justify-between gap-3">
        <h4 className="text-sm font-semibold text-ink/80">
          <span className="text-accent">{statement.subj}</span>{" "}
          <span className="text-ink/50">{RELATION_LABEL[statement.relation]}</span>{" "}
          <span className="text-accent">{statement.obj}</span>
        </h4>
        <span className="shrink-0 rounded-full bg-ink/[0.05] px-2 py-0.5 text-xs font-medium text-ink/60">
          belief {statement.belief.toFixed(2)}
        </span>
      </div>

      {/* Translation confidence + human-in-vivo badge */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tone.className}`}>
          Translation confidence: {tone.label} ({statement.translationConfidence.toFixed(2)})
        </span>
        {humanInVivo ? (
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800">
            Human in-vivo
          </span>
        ) : null}
      </div>

      {/* Resolved context */}
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
        <ContextChip label="Tissue" value={context.tissue ?? "unknown"} />
        <ContextChip
          label="Species"
          value={context.species ? SPECIES_LABEL[context.species] : "unknown"}
        />
        <ContextChip label="Assay" value={context.assay ? ASSAY_LABEL[context.assay] : "unknown"} />
      </div>

      {/* Grounded context tags — the verbatim evidence behind each context value */}
      {context.tags.length > 0 ? (
        <div className="mt-3 space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-ink/40">
            Grounded context ({context.tags.length})
          </p>
          {context.tags.map((tag, i) => (
            <div
              key={`${tag.kind}-${i}`}
              className="rounded-md border-l-2 border-accent/50 bg-ink/[0.03] px-3 py-2"
            >
              <div className="flex items-center gap-2 text-xs">
                <span className="font-medium text-ink/50">{tag.kind}</span>
                <span className="font-mono text-ink/70">{tag.value}</span>
                <span className="text-ink/30">· {tag.grounding.status}</span>
              </div>
              <p className="mt-1 text-xs italic text-ink/60">&ldquo;{tag.quote}&rdquo;</p>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-xs text-ink/40">
          No stated biological context could be grounded for this mechanism.
        </p>
      )}
    </div>
  );
}
