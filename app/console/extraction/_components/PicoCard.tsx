import type { Pico, Endpoint, EndpointRole } from "./types";

// Structured PICO summary card + endpoints list, extracted by Claude from the
// full paper. Purely presentational.

const ROLE_STYLES: Record<EndpointRole, string> = {
  primary: "bg-accent/15 text-accent",
  secondary: "bg-ink/10 text-ink/60",
  safety: "bg-amber-100 text-amber-800",
  other: "bg-ink/5 text-ink/40",
};

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[7rem_1fr] gap-3 py-2">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-ink/40">{label}</dt>
      <dd className="text-sm text-ink/80">{value}</dd>
    </div>
  );
}

interface PicoCardProps {
  pico: Pico;
  endpoints: Endpoint[];
}

export function PicoCard({ pico, endpoints }: PicoCardProps) {
  return (
    <div className="rounded-lg border border-ink/10 bg-white p-5">
      <h2 className="text-[11px] font-semibold uppercase tracking-wide text-ink/40">
        PICO
      </h2>
      <dl className="mt-2 divide-y divide-ink/5">
        <Row label="Population" value={pico.population} />
        <Row label="Intervention" value={pico.intervention} />
        <Row label="Comparator" value={pico.comparator} />
        <div className="grid grid-cols-[7rem_1fr] gap-3 py-2">
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-ink/40">Outcomes</dt>
          <dd className="text-sm text-ink/80">
            {pico.outcomes.length > 0 ? (
              <ul className="list-inside list-disc space-y-1">
                {pico.outcomes.map((o, i) => (
                  <li key={`${o}-${i}`}>{o}</li>
                ))}
              </ul>
            ) : (
              <span className="text-ink/40">not reported</span>
            )}
          </dd>
        </div>
      </dl>

      {endpoints.length > 0 ? (
        <div className="mt-4 border-t border-ink/5 pt-4">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-ink/40">
            Endpoints
          </h3>
          <ul className="mt-2 space-y-2">
            {endpoints.map((ep, i) => (
              <li key={`${ep.name}-${i}`} className="flex items-start gap-2 text-sm text-ink/75">
                <span
                  className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${ROLE_STYLES[ep.role]}`}
                >
                  {ep.role}
                </span>
                <span>
                  {ep.name}
                  {ep.timepoint && ep.timepoint.toLowerCase() !== "not reported" ? (
                    <span className="text-ink/40"> — {ep.timepoint}</span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
