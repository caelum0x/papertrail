"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { StepShell } from "./StepShell";
import { seedSample } from "./api";
import type { SeededSample } from "./types";

// Fourth wizard step (optional). Seeds a demo project + demo claim so the user has
// something real to explore. Requires editor+ to write into the workspace; viewers
// see a note and can skip. Seeding is idempotent per org.

interface SampleDataStepProps {
  canEdit: boolean;
  onBack: () => void;
  onContinue: () => void;
  busy: boolean;
  error: string | null;
}

export function SampleDataStep({
  canEdit,
  onBack,
  onContinue,
  busy,
  error,
}: SampleDataStepProps) {
  const [seeding, setSeeding] = useState(false);
  const [seedError, setSeedError] = useState<string | null>(null);
  const [result, setResult] = useState<SeededSample | null>(null);

  const onSeed = useCallback(async () => {
    setSeeding(true);
    setSeedError(null);
    const res = await seedSample();
    setSeeding(false);
    if (res.error || !res.data) {
      setSeedError(res.error ?? "Couldn't load sample data.");
      return;
    }
    setResult(res.data);
  }, []);

  return (
    <StepShell
      title="Load sample data"
      blurb="Seed a demo project and a sample claim so you can walk a full provenance trail before importing your own."
      onBack={onBack}
      primaryLabel={result ? "Continue" : "Skip for now"}
      onPrimary={onContinue}
      primaryBusy={busy}
      secondaryLabel={result ? "Skip" : undefined}
      onSecondary={result ? onContinue : undefined}
      error={error}
    >
      {canEdit ? (
        <div>
          {result ? (
            <div className="rounded border border-accent/20 bg-accent/5 p-4">
              <p className="text-sm font-medium text-ink/80">
                {result.already_existed
                  ? "Sample data is ready"
                  : "Sample data loaded"}
              </p>
              <p className="mt-1 text-sm text-ink/60">
                Project “{result.project.name}” and a demo claim are in your
                workspace.
              </p>
              <div className="mt-3 flex flex-wrap gap-4 text-sm">
                <Link
                  href={`/console/projects/${result.project.id}`}
                  className="text-accent hover:underline"
                >
                  View project
                </Link>
                <Link
                  href={`/console/claims/${result.claim.id}`}
                  className="text-accent hover:underline"
                >
                  View demo claim
                </Link>
              </div>
            </div>
          ) : (
            <div className="rounded border border-ink/10 bg-paper p-4">
              <p className="text-sm text-ink/60">
                We&apos;ll create one demo project and a single clinical-trial
                claim you can run a verification against. Nothing is sent to your
                team.
              </p>
              <button
                type="button"
                onClick={onSeed}
                disabled={seeding}
                className="mt-3 rounded bg-accent px-4 py-2 text-sm text-white disabled:opacity-50"
              >
                {seeding ? "Loading…" : "Load sample data"}
              </button>
              {seedError ? (
                <p className="mt-3 text-sm text-red-600">{seedError}</p>
              ) : null}
            </div>
          )}
        </div>
      ) : (
        <p className="text-sm text-ink/60">
          Only editors and above can add sample data to the workspace. You can
          skip this step and continue.
        </p>
      )}
    </StepShell>
  );
}
