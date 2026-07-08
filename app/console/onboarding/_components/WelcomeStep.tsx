"use client";

import { StepShell } from "./StepShell";

// First wizard step. Orients the user on what PaperTrail does and what the next
// few steps will cover, then marks itself complete when they continue.

interface WelcomeStepProps {
  onContinue: () => void;
  busy: boolean;
  error: string | null;
}

const HIGHLIGHTS = [
  {
    title: "Trace claims to their source",
    body: "Paste a clinical-trial efficacy claim and PaperTrail finds the primary source on PubMed or ClinicalTrials.gov.",
  },
  {
    title: "Flag discrepancies",
    body: "It compares the claim against the actual finding and surfaces distortions with a trust score.",
  },
  {
    title: "Keep a citation trail",
    body: "Every verdict maps back to an exact substring of the cached source — no unsourced claims.",
  },
];

export function WelcomeStep({ onContinue, busy, error }: WelcomeStepProps) {
  return (
    <StepShell
      title="Welcome to PaperTrail"
      blurb="A provenance agent for clinical-trial efficacy claims. Here's what you'll do in the next few steps."
      primaryLabel="Get started"
      onPrimary={onContinue}
      primaryBusy={busy}
      error={error}
    >
      <ul className="space-y-4">
        {HIGHLIGHTS.map((h) => (
          <li key={h.title} className="flex gap-3">
            <span
              aria-hidden
              className="mt-1 h-2 w-2 flex-none rounded-full bg-accent"
            />
            <div>
              <p className="text-sm font-medium text-ink/80">{h.title}</p>
              <p className="mt-0.5 text-sm text-ink/60">{h.body}</p>
            </div>
          </li>
        ))}
      </ul>
    </StepShell>
  );
}
