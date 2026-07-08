"use client";

import { SetupWizard } from "./_components/SetupWizard";

// Onboarding & workspace setup. A thin shell that composes the multi-step
// SetupWizard (welcome → workspace → invite → sample data → finish) with a
// checklist sidebar and progress bar. All data flows through /api/onboarding/*.

export default function OnboardingPage() {
  return (
    <div className="max-w-4xl">
      <div>
        <h1 className="text-2xl font-semibold text-ink/80">
          Welcome to PaperTrail
        </h1>
        <p className="mt-1 text-sm text-ink/60">
          A few quick steps to get your workspace ready.
        </p>
      </div>

      <div className="mt-6">
        <SetupWizard />
      </div>
    </div>
  );
}
