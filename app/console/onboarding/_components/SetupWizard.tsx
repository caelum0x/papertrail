"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Stepper } from "./Stepper";
import { ProgressBar } from "./ProgressBar";
import { ChecklistSidebar } from "./ChecklistSidebar";
import { WelcomeStep } from "./WelcomeStep";
import { WorkspaceStep } from "./WorkspaceStep";
import { InviteStep } from "./InviteStep";
import { SampleDataStep } from "./SampleDataStep";
import { FinishStep } from "./FinishStep";
import { useSession } from "./useSession";
import { completeStep, fetchChecklist, fetchState } from "./api";
import { STEP_IDS, type Checklist, type OnboardingState, type StepId } from "./types";

// Orchestrates the multi-step onboarding wizard. Loads the user's saved state so a
// returning user resumes at their first incomplete step, tracks the current step
// locally, and persists progress via /api/onboarding/complete-step. Composes the
// five step components + a checklist sidebar + progress bar.

const STEP_ORDER: { id: StepId; title: string }[] = [
  { id: "welcome", title: "Welcome" },
  { id: "workspace", title: "Workspace" },
  { id: "invite", title: "Invite" },
  { id: "sample_data", title: "Sample data" },
  { id: "finish", title: "Finish" },
];

// Given the saved state, pick the step to open on: the first step without a saved
// completion timestamp, or the final step if everything is done.
function firstIncompleteIndex(state: OnboardingState | null): number {
  if (!state) return 0;
  for (let i = 0; i < STEP_IDS.length; i += 1) {
    if (!state.steps[STEP_IDS[i]]) return i;
  }
  return STEP_IDS.length - 1;
}

export function SetupWizard() {
  const router = useRouter();
  const session = useSession();

  const [state, setState] = useState<OnboardingState | null>(null);
  const [checklist, setChecklist] = useState<Checklist | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [stepError, setStepError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const [stateRes, checklistRes] = await Promise.all([
      fetchState(),
      fetchChecklist(),
    ]);
    if (stateRes.error || !stateRes.data) {
      setLoadError(stateRes.error ?? "Couldn't load your onboarding progress.");
      setLoading(false);
      return;
    }
    setState(stateRes.data);
    setChecklist(checklistRes.data);
    setStepIndex(firstIncompleteIndex(stateRes.data));
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const doneIds = useMemo<Set<StepId>>(() => {
    const set = new Set<StepId>();
    if (state) {
      for (const id of STEP_IDS) {
        if (state.steps[id]) set.add(id);
      }
    }
    return set;
  }, [state]);

  // Persists completion of a step, refreshes the checklist, then advances.
  const advance = useCallback(
    async (step: StepId, nextIndex: number) => {
      setSaving(true);
      setStepError(null);
      const res = await completeStep(step);
      setSaving(false);
      if (res.error || !res.data) {
        setStepError(res.error ?? "Couldn't save your progress.");
        return false;
      }
      setState(res.data);
      const cl = await fetchChecklist();
      if (cl.data) setChecklist(cl.data);
      setStepIndex(nextIndex);
      return true;
    },
    []
  );

  const goNext = useCallback(
    (step: StepId) => {
      const nextIndex = Math.min(stepIndex + 1, STEP_ORDER.length - 1);
      void advance(step, nextIndex);
    },
    [advance, stepIndex]
  );

  const goBack = useCallback(() => {
    setStepError(null);
    setStepIndex((i) => Math.max(0, i - 1));
  }, []);

  const jumpTo = useCallback((step: StepId) => {
    setStepError(null);
    const idx = STEP_ORDER.findIndex((s) => s.id === step);
    if (idx >= 0) setStepIndex(idx);
  }, []);

  const onFinish = useCallback(async () => {
    const ok = await advance("finish", stepIndex);
    if (ok) router.push("/console");
  }, [advance, router, stepIndex]);

  if (loading) {
    return (
      <div className="rounded-lg border border-ink/10 bg-white p-10 text-center text-sm text-ink/40">
        Loading your setup…
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="rounded-lg border border-ink/10 bg-white p-6">
        <p className="text-sm text-red-600">{loadError}</p>
        <button
          type="button"
          onClick={load}
          className="mt-3 text-sm text-accent hover:underline"
        >
          Try again
        </button>
      </div>
    );
  }

  const current = STEP_ORDER[stepIndex];

  return (
    <div>
      <div className="rounded-lg border border-ink/10 bg-white p-5">
        <Stepper steps={STEP_ORDER} currentIndex={stepIndex} doneIds={doneIds} />
        {checklist ? (
          <div className="mt-4">
            <ProgressBar
              percent={checklist.percent}
              requiredDone={checklist.required_done}
              requiredTotal={checklist.required_total}
            />
          </div>
        ) : null}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_18rem]">
        <div>
          {current.id === "welcome" ? (
            <WelcomeStep
              onContinue={() => goNext("welcome")}
              busy={saving}
              error={stepError}
            />
          ) : null}
          {current.id === "workspace" ? (
            <WorkspaceStep
              activeOrg={session.activeOrg}
              onBack={goBack}
              onContinue={() => goNext("workspace")}
              busy={saving}
              error={stepError}
            />
          ) : null}
          {current.id === "invite" ? (
            <InviteStep
              canInvite={session.canInvite}
              onBack={goBack}
              onContinue={() => goNext("invite")}
              busy={saving}
              error={stepError}
            />
          ) : null}
          {current.id === "sample_data" ? (
            <SampleDataStep
              canEdit={session.canEdit}
              onBack={goBack}
              onContinue={() => goNext("sample_data")}
              busy={saving}
              error={stepError}
            />
          ) : null}
          {current.id === "finish" ? (
            <FinishStep
              onBack={goBack}
              onFinish={onFinish}
              busy={saving}
              error={stepError}
            />
          ) : null}
        </div>

        <ChecklistSidebar
          checklist={checklist}
          currentStep={current.id}
          onJump={jumpTo}
        />
      </div>
    </div>
  );
}
