import type {
  Entity,
  Observation,
  Outcome,
  ProtocolStep,
  Reagent,
  Sample,
  StructuredExperiment,
} from "./types";

// Renders a structured experiment record. Every field that quotes the raw notes is shown
// with its verbatim grounded span underneath — the grounding is the whole point, so we
// surface it, not hide it. Shared by StructuredPreview (before save) and ExperimentDetail
// (a saved record), so it takes no callbacks and does no fetching.

const ENTITY_LABEL: Record<Entity["type"], string> = {
  gene: "Gene",
  protein: "Protein",
  cell_line: "Cell line",
  reagent: "Reagent",
  organism: "Organism",
  method: "Method",
  other: "Other",
};

function GroundedQuote({ span }: { span: string }) {
  return (
    <p className="mt-1 border-l-2 border-accent/50 bg-ink/[0.03] px-2 py-1 text-xs italic text-ink/50">
      <span className="not-italic font-medium text-ink/40">quoted: </span>
      &ldquo;{span}&rdquo;
    </p>
  );
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  if (count === 0) return null;
  return (
    <section>
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink/40">
        {title} ({count})
      </h4>
      {children}
    </section>
  );
}

function ProtocolSteps({ steps }: { steps: ProtocolStep[] }) {
  return (
    <ol className="space-y-2">
      {steps.map((step, i) => (
        <li key={`${step.order}-${i}`} className="rounded-md border border-ink/15 p-3">
          <div className="flex gap-2">
            <span className="shrink-0 font-mono text-xs text-accent">{step.order}.</span>
            <div className="min-w-0">
              <p className="text-sm text-ink/80">{step.text}</p>
              <GroundedQuote span={step.source_span} />
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

function Reagents({ reagents }: { reagents: Reagent[] }) {
  return (
    <ul className="space-y-2">
      {reagents.map((r, i) => (
        <li key={`${r.name}-${i}`} className="rounded-md border border-ink/15 p-3">
          <p className="text-sm font-medium text-ink/80">{r.name}</p>
          <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink/50">
            {r.vendor ? (
              <div className="flex gap-1">
                <dt className="font-medium text-ink/40">vendor</dt>
                <dd>{r.vendor}</dd>
              </div>
            ) : null}
            {r.catalog ? (
              <div className="flex gap-1">
                <dt className="font-medium text-ink/40">cat#</dt>
                <dd className="font-mono">{r.catalog}</dd>
              </div>
            ) : null}
            {r.amount ? (
              <div className="flex gap-1">
                <dt className="font-medium text-ink/40">amount</dt>
                <dd>{r.amount}</dd>
              </div>
            ) : null}
          </dl>
          <GroundedQuote span={r.source_span} />
        </li>
      ))}
    </ul>
  );
}

function SpannedList({ items }: { items: (Sample | Observation | Outcome)[] }) {
  return (
    <ul className="space-y-2">
      {items.map((item, i) => (
        <li key={i} className="rounded-md border border-ink/15 p-3">
          <p className="text-sm text-ink/80">{item.text}</p>
          <GroundedQuote span={item.source_span} />
        </li>
      ))}
    </ul>
  );
}

interface StructuredRecordProps {
  structured: StructuredExperiment;
}

export function StructuredRecord({ structured }: StructuredRecordProps) {
  return (
    <div className="space-y-5">
      {structured.objective ? (
        <section>
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink/40">
            Objective
          </h4>
          <p className="text-sm text-ink/80">{structured.objective}</p>
        </section>
      ) : null}

      <Section title="Protocol steps" count={structured.protocol_steps.length}>
        <ProtocolSteps steps={structured.protocol_steps} />
      </Section>

      <Section title="Reagents" count={structured.reagents.length}>
        <Reagents reagents={structured.reagents} />
      </Section>

      <Section title="Samples" count={structured.samples.length}>
        <SpannedList items={structured.samples} />
      </Section>

      <Section title="Equipment" count={structured.equipment.length}>
        <div className="flex flex-wrap gap-2">
          {structured.equipment.map((e, i) => (
            <span
              key={`${e}-${i}`}
              className="rounded-full border border-ink/15 px-2.5 py-0.5 text-xs text-ink/70"
            >
              {e}
            </span>
          ))}
        </div>
      </Section>

      <Section title="Observations" count={structured.observations.length}>
        <SpannedList items={structured.observations} />
      </Section>

      <Section title="Outcomes" count={structured.outcomes.length}>
        <SpannedList items={structured.outcomes} />
      </Section>

      <Section title="Next steps" count={structured.next_steps.length}>
        <ul className="list-disc space-y-1 pl-5 text-sm text-ink/70">
          {structured.next_steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ul>
      </Section>

      <Section title="Entities" count={structured.entities.length}>
        <div className="flex flex-wrap gap-2">
          {structured.entities.map((e, i) => (
            <span
              key={`${e.name}-${i}`}
              className="rounded-full bg-accent/10 px-2.5 py-0.5 text-xs text-accent"
              title={ENTITY_LABEL[e.type]}
            >
              <span className="font-medium">{ENTITY_LABEL[e.type]}:</span> {e.name}
            </span>
          ))}
        </div>
      </Section>
    </div>
  );
}
