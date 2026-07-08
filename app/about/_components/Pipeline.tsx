import { PIPELINE_STAGES, type PipelineStage } from "./aboutData";

/** A single pipeline stage card. */
export function PipelineStageCard({ stage }: { stage: PipelineStage }) {
  return (
    <li className="rounded-lg border border-ink/10 bg-white p-5">
      <div className="flex items-baseline gap-2">
        <span className="text-xs font-semibold text-accent">{stage.stage}</span>
        <h3 className="text-base font-semibold">{stage.title}</h3>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-ink/80">{stage.body}</p>
    </li>
  );
}

/** The full three-stage pipeline, composed from the stage cards. */
export function Pipeline() {
  return (
    <ol className="space-y-5">
      {PIPELINE_STAGES.map((stage) => (
        <PipelineStageCard key={stage.title} stage={stage} />
      ))}
    </ol>
  );
}
