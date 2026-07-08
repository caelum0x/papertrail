"use client";

import Link from "next/link";
import { StepShell } from "./StepShell";

// Final wizard step. Summarizes what's next and, on primary action, marks the
// "finish" step complete (which flips onboarding_state.completed) and routes the
// user into the console.

interface FinishStepProps {
  onBack: () => void;
  onFinish: () => void;
  busy: boolean;
  error: string | null;
}

const NEXT_ACTIONS = [
  {
    href: "/console/claims/new",
    label: "Run your first verification",
    body: "Paste a claim and trace it back to its primary source.",
  },
  {
    href: "/console/import",
    label: "Import your claims",
    body: "Bulk-load a set of claims to verify from a file.",
  },
  {
    href: "/console/team",
    label: "Manage your team",
    body: "Invite more collaborators and set their roles.",
  },
];

export function FinishStep({ onBack, onFinish, busy, error }: FinishStepProps) {
  return (
    <StepShell
      title="You're all set"
      blurb="Your workspace is ready. Here are a few good next steps."
      onBack={onBack}
      primaryLabel="Go to console"
      onPrimary={onFinish}
      primaryBusy={busy}
      error={error}
    >
      <ul className="space-y-3">
        {NEXT_ACTIONS.map((a) => (
          <li key={a.href}>
            <Link
              href={a.href}
              className="block rounded border border-ink/10 bg-paper p-4 transition-colors hover:border-accent/40"
            >
              <p className="text-sm font-medium text-accent">{a.label}</p>
              <p className="mt-0.5 text-sm text-ink/60">{a.body}</p>
            </Link>
          </li>
        ))}
      </ul>
    </StepShell>
  );
}
