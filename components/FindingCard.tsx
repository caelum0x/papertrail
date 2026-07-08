import { ExtractedFinding } from "@/lib/schemas";

interface FindingCardProps {
  finding: ExtractedFinding;
}

function isReported(value: string): boolean {
  return value.trim().toLowerCase() !== "not reported" && value.trim() !== "";
}

function FieldRow({ label, value }: { label: string; value: string }) {
  const reported = isReported(value);
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-ink/40">{label}</div>
      <p className={`mt-0.5 text-sm ${reported ? "text-ink/70" : "text-ink/40 italic"}`}>
        {reported ? value : "Not reported"}
      </p>
    </div>
  );
}

export function FindingCard({ finding }: FindingCardProps) {
  const caveats = finding.caveats.filter((caveat) => caveat.trim() !== "");
  return (
    <div className="rounded-lg border border-ink/10 bg-white p-4">
      <div className="mb-3 text-xs font-medium uppercase tracking-wide text-ink/40">
        What the source found
      </div>
      <div className="space-y-3">
        <FieldRow label="Effect size" value={finding.effect_size} />
        <FieldRow label="Population" value={finding.population} />
        <FieldRow label="Condition" value={finding.condition} />
        <FieldRow label="Endpoint" value={finding.endpoint} />
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-ink/40">Caveats</div>
          {caveats.length > 0 ? (
            <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-ink/70">
              {caveats.map((caveat, index) => (
                <li key={index}>{caveat}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-0.5 text-sm italic text-ink/40">None reported</p>
          )}
        </div>
      </div>
    </div>
  );
}
