"use client";

// The extracted, de-identified patient profile rendered as grounded chips. Each quoted
// fact carries a source_span (verbatim from the notes) surfaced as the chip's title tooltip,
// making the grounding auditable at a glance. Shows the dropped-ungrounded count when any
// spans could not be located.

import type { PatientProfile } from "./types";

interface ProfileCardProps {
  profile: PatientProfile;
  droppedUngrounded?: number;
}

function Chip({ label, span }: { label: string; span?: string }) {
  return (
    <span
      title={span ? `Source: “${span}”` : undefined}
      className="inline-flex max-w-full items-center rounded-full border border-ink/15 bg-paper px-2.5 py-0.5 text-xs text-ink/70"
    >
      <span className="truncate">{label}</span>
    </span>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-ink/40">{title}</div>
      <div className="mt-1.5 flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

export function ProfileCard({ profile, droppedUngrounded }: ProfileCardProps) {
  const hasStructured =
    profile.age !== null ||
    profile.sex !== null ||
    profile.performance_status !== null ||
    profile.conditions.length > 0 ||
    profile.biomarkers.length > 0 ||
    profile.prior_treatments.length > 0 ||
    profile.labs.length > 0 ||
    profile.other_factors.length > 0;

  return (
    <div className="rounded-lg border border-ink/15 bg-white p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-ink/70">Extracted patient profile</h3>
        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800">
          De-identified · grounded
        </span>
      </div>

      {!hasStructured ? (
        <p className="mt-3 text-sm text-ink/40">
          No structured, groundable facts were extracted from the notes.
        </p>
      ) : (
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          {(profile.age !== null || profile.sex !== null || profile.performance_status !== null) && (
            <Section title="Demographics">
              {profile.age !== null ? <Chip label={`Age ${profile.age}`} /> : null}
              {profile.sex ? <Chip label={profile.sex} /> : null}
              {profile.performance_status ? (
                <Chip label={`PS: ${profile.performance_status}`} />
              ) : null}
            </Section>
          )}

          {profile.conditions.length > 0 && (
            <Section title="Conditions">
              {profile.conditions.map((c, i) => (
                <Chip key={`c-${i}`} label={c.name} span={c.source_span} />
              ))}
            </Section>
          )}

          {profile.biomarkers.length > 0 && (
            <Section title="Biomarkers">
              {profile.biomarkers.map((b, i) => (
                <Chip
                  key={`b-${i}`}
                  label={b.status ? `${b.name} · ${b.status}` : b.name}
                  span={b.source_span}
                />
              ))}
            </Section>
          )}

          {profile.prior_treatments.length > 0 && (
            <Section title="Prior treatments">
              {profile.prior_treatments.map((t, i) => (
                <Chip key={`t-${i}`} label={t.name} span={t.source_span} />
              ))}
            </Section>
          )}

          {profile.labs.length > 0 && (
            <Section title="Labs">
              {profile.labs.map((l, i) => (
                <Chip key={`l-${i}`} label={`${l.name}: ${l.value}`} span={l.source_span} />
              ))}
            </Section>
          )}

          {profile.other_factors.length > 0 && (
            <Section title="Other factors">
              {profile.other_factors.map((o, i) => (
                <Chip key={`o-${i}`} label={o.text} span={o.source_span} />
              ))}
            </Section>
          )}
        </div>
      )}

      {droppedUngrounded && droppedUngrounded > 0 ? (
        <p className="mt-3 text-xs text-ink/40">
          {droppedUngrounded} extracted fact{droppedUngrounded === 1 ? "" : "s"} dropped for not
          quoting the notes verbatim.
        </p>
      ) : null}
    </div>
  );
}
