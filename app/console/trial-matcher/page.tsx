"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ModuleHeader } from "../claims/_components/ModuleHeader";
import { LoadingBanner } from "@/components/console/StateBanners";
import { PatientInput } from "./_components/PatientInput";
import { ProfileCard } from "./_components/ProfileCard";
import { MatchResults, type MatchView } from "./_components/MatchResults";
import { RunHistory } from "./_components/RunHistory";
import { EXAMPLE_PATIENT_NOTES } from "./_components/example";
import { fetchRun, fetchRuns, runMatch } from "./_components/api";
import type {
  PatientProfile,
  RunDetailResponse,
  RunResponse,
  TrialMatch,
  TrialMatchRow,
  TrialMatchRunRow,
} from "./_components/types";

// CLINICAL TRIAL MATCHER console: a coordinator pastes de-identified patient notes; Claude
// extracts a grounded patient profile; we search ClinicalTrials.gov and assess each candidate
// trial's eligibility criteria against the profile (met / not_met / unknown, grounded to the
// exact criterion text) and rank trials by fit. The inclusion/exclusion reasoning is shown
// for every match. Prior runs are org-scoped and reloadable from the history panel.

// Normalise a fresh POST match (camelCase) into the MatchView the results component renders.
function freshToView(m: TrialMatch, i: number): MatchView {
  return {
    key: `${m.nctId}-${i}`,
    nctId: m.nctId,
    title: m.title,
    url: m.url,
    phase: m.phase,
    overallStatus: m.overallStatus,
    eligibilityScore: m.eligibility_score,
    verdict: m.verdict,
    criteria: m.criteria,
  };
}

// Normalise a persisted match row (snake_case) into the MatchView shape.
function rowToView(m: TrialMatchRow): MatchView {
  return {
    key: m.id,
    nctId: m.nct_id,
    title: m.title,
    url: m.url,
    phase: m.phase,
    overallStatus: m.overall_status,
    eligibilityScore: m.eligibility_score,
    verdict: m.verdict,
    criteria: m.criteria,
  };
}

export default function TrialMatcherPage() {
  const [notes, setNotes] = useState("");
  const [matching, setMatching] = useState(false);
  const [matchError, setMatchError] = useState<string | null>(null);
  const [degradedMessage, setDegradedMessage] = useState<string | null>(null);

  const [profile, setProfile] = useState<PatientProfile | null>(null);
  const [droppedUngrounded, setDroppedUngrounded] = useState(0);
  const [matches, setMatches] = useState<MatchView[]>([]);
  const [hasResult, setHasResult] = useState(false);

  // Latest notes, so the example loader can auto-run with the just-set value without waiting
  // for a state flush (setState is async; a ref gives onMatch the fresh notes immediately).
  const notesRef = useRef("");
  const setNotesTracked = useCallback((value: string) => {
    notesRef.current = value;
    setNotes(value);
  }, []);

  const [runs, setRuns] = useState<TrialMatchRunRow[]>([]);
  const [runsLoading, setRunsLoading] = useState(true);
  const [runsError, setRunsError] = useState<string | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);

  const loadRuns = useCallback(async () => {
    setRunsLoading(true);
    setRunsError(null);
    const res = await fetchRuns(1, 25);
    if (res.error) {
      setRunsError(res.error);
      setRuns([]);
    } else {
      setRuns(res.data ?? []);
    }
    setRunsLoading(false);
  }, []);

  useEffect(() => {
    void loadRuns();
  }, [loadRuns]);

  const applyRun = useCallback(
    (
      p: PatientProfile,
      views: MatchView[],
      dropped: number,
      runId: string | null
    ) => {
      setProfile(p);
      setMatches(views);
      setDroppedUngrounded(dropped);
      setActiveRunId(runId);
      setHasResult(true);
    },
    []
  );

  const runWithNotes = useCallback(
    async (rawNotes: string) => {
      const trimmed = rawNotes.trim();
      if (trimmed.length < 10) {
        setMatchError("Paste at least 10 characters of de-identified notes.");
        return;
      }
      setMatching(true);
      setMatchError(null);
      setDegradedMessage(null);
      const res = await runMatch(trimmed);
      setMatching(false);

      if (res.error || !res.data) {
        setMatchError(res.error ?? "Failed to match trials.");
        return;
      }

      const data: RunResponse = res.data;
      // Honest degraded surface: show WHY (usage cap / error) without white-screening.
      setDegradedMessage(data.degradedMessage);

      if (!data.run) {
        // Profile extraction never completed (e.g. Claude usage-capped). There is nothing to
        // display beyond the banner — steer the coordinator to reload a prior run from history.
        return;
      }

      applyRun(
        data.run.profile,
        data.matches.map(freshToView),
        data.droppedUngrounded,
        data.run.id
      );
      void loadRuns();
    },
    [applyRun, loadRuns]
  );

  const onMatch = useCallback(() => {
    void runWithNotes(notesRef.current || notes);
  }, [runWithNotes, notes]);

  const onTryExample = useCallback(() => {
    setNotesTracked(EXAMPLE_PATIENT_NOTES);
    void runWithNotes(EXAMPLE_PATIENT_NOTES);
  }, [runWithNotes, setNotesTracked]);

  const onSelectRun = useCallback(
    async (id: string) => {
      setActiveRunId(id);
      setMatchError(null);
      setDegradedMessage(null);
      setMatching(true);
      const res = await fetchRun(id);
      setMatching(false);
      if (res.error || !res.data) {
        setMatchError(res.error ?? "Failed to load run.");
        return;
      }
      const detail: RunDetailResponse = res.data;
      applyRun(detail.run.profile, detail.matches.map(rowToView), 0, id);
    },
    [applyRun]
  );

  return (
    <div className="space-y-6">
      <ModuleHeader
        title="Clinical trial matcher"
        subtitle="Find eligible trials on ClinicalTrials.gov for a patient. Each match shows which inclusion and exclusion criteria the patient meets or fails, with the evidence from the notes."
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-6">
          <PatientInput
            notes={notes}
            onChange={setNotesTracked}
            onMatch={onMatch}
            onTryExample={onTryExample}
            loading={matching}
            error={matchError}
          />

          {degradedMessage ? (
            <div
              role="status"
              aria-live="polite"
              className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
            >
              <strong className="font-semibold">Running in degraded mode.</strong>{" "}
              {degradedMessage}
            </div>
          ) : null}

          {matching ? (
            <LoadingBanner message="Extracting the patient profile and assessing candidate trials…" />
          ) : hasResult ? (
            <div className="space-y-6">
              {profile ? (
                <ProfileCard profile={profile} droppedUngrounded={droppedUngrounded} />
              ) : null}
              <section>
                <h3 className="mb-3 text-sm font-semibold text-ink/70">
                  Ranked trial matches ({matches.length})
                </h3>
                <MatchResults matches={matches} />
              </section>
            </div>
          ) : (
            <div className="rounded-lg border border-ink/15 bg-white p-6 text-sm text-ink/50">
              <p className="font-medium text-ink/70">No match run yet.</p>
              <p className="mt-2">
                Paste de-identified patient notes above, or click{" "}
                <span className="font-medium text-accent">Try an example</span> to load a realistic
                HER2+ metastatic breast cancer vignette and see ranked trials with per-criterion
                eligibility reasoning in one click.
              </p>
              <p className="mt-2 text-xs text-ink/40">
                This tool is for de-identified patient notes only — never include patient names,
                MRNs, or dates of birth. PaperTrail keeps no copy of the raw notes.
              </p>
            </div>
          )}
        </div>

        <RunHistory
          runs={runs}
          loading={runsLoading}
          error={runsError}
          activeRunId={activeRunId}
          onSelect={(id) => void onSelectRun(id)}
        />
      </div>
    </div>
  );
}
