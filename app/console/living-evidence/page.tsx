"use client";

import { useCallback, useEffect, useState } from "react";
import { ModuleHeader } from "../claims/_components/ModuleHeader";
import { LoadingBanner, ErrorBanner } from "@/components/console/StateBanners";
import { StudyRowsEditor, makeEmptyStudy } from "./_components/StudyRowsEditor";
import { CumulativeTimeline } from "./_components/CumulativeTimeline";
import { FlipVerdictBadge } from "./_components/FlipVerdictBadge";
import {
  assessLiving,
  createMonitor,
  fetchMonitors,
} from "./_components/api";
import type { AssessmentView, MonitorView, StudyInput } from "./_components/types";

// Living-evidence monitoring console. A monitor watches a topic/claim; when a new
// study lands, the deterministic cumulative meta-analysis re-pools the evidence in
// time order and flags whether the pooled verdict would FLIP. Nothing here is
// decided by an LLM — every estimate and verdict comes from the pooling engine.

const DEFAULT_YEAR = new Date().getFullYear();

export default function LivingEvidencePage() {
  const [monitors, setMonitors] = useState<MonitorView[]>([]);
  const [monitorsError, setMonitorsError] = useState<string | null>(null);

  const [topic, setTopic] = useState("");
  const [query, setQuery] = useState("");
  const [studies, setStudies] = useState<StudyInput[]>([
    { label: "", measure: "RR", year: DEFAULT_YEAR - 4, point: null, ciLower: null, ciUpper: null },
    { label: "", measure: "RR", year: DEFAULT_YEAR - 2, point: null, ciLower: null, ciUpper: null },
  ]);
  const [candidate, setCandidate] = useState<StudyInput[]>([makeEmptyStudy(DEFAULT_YEAR)]);

  const [assessment, setAssessment] = useState<AssessmentView | null>(null);
  const [assessing, setAssessing] = useState(false);
  const [assessError, setAssessError] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createdNotice, setCreatedNotice] = useState<string | null>(null);

  const loadMonitors = useCallback(async () => {
    const res = await fetchMonitors();
    if (res.error) {
      setMonitorsError(res.error);
      return;
    }
    setMonitorsError(null);
    setMonitors(res.data ?? []);
  }, []);

  useEffect(() => {
    void loadMonitors();
  }, [loadMonitors]);

  const runAssess = useCallback(async () => {
    setAssessing(true);
    setAssessError(null);
    const res = await assessLiving(studies, candidate[0]);
    setAssessing(false);
    if (res.error || !res.data) {
      setAssessError(res.error ?? "Assessment failed.");
      setAssessment(null);
      return;
    }
    setAssessment(res.data);
  }, [studies, candidate]);

  const saveMonitor = useCallback(async () => {
    if (topic.trim().length < 4) {
      setCreateError("Topic must be at least 4 characters.");
      return;
    }
    setCreating(true);
    setCreateError(null);
    setCreatedNotice(null);
    const res = await createMonitor({
      topic: topic.trim(),
      query: query.trim() || undefined,
      baseline: studies,
    });
    setCreating(false);
    if (res.error || !res.data) {
      setCreateError(res.error ?? "Failed to create monitor.");
      return;
    }
    setCreatedNotice(`Monitor "${res.data.topic}" created.`);
    setTopic("");
    setQuery("");
    await loadMonitors();
  }, [topic, query, studies, loadMonitors]);

  return (
    <div className="space-y-6">
      <ModuleHeader
        title="Living evidence monitoring"
        subtitle="Watch a claim's evidence base. When a new study lands, PaperTrail re-pools the evidence in time order and flags — deterministically — whether the pooled verdict would flip."
      />

      {/* Monitor + baseline */}
      <div className="rounded-lg border border-ink/15 bg-white p-4">
        <h3 className="text-sm font-semibold text-ink/70">Monitor</h3>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <div>
            <label className="block text-xs font-medium text-ink/70" htmlFor="topic">
              Topic or claim
            </label>
            <input
              id="topic"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="SGLT2 inhibitors reduce HF hospitalisation in T2D"
              className="mt-1 w-full rounded-md border border-ink/15 bg-white px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-ink/70" htmlFor="query">
              Search query (optional)
            </label>
            <input
              id="query"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="sglt2 heart failure hospitalization"
              className="mt-1 w-full rounded-md border border-ink/15 bg-white px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none"
            />
          </div>
        </div>

        <h4 className="mt-5 text-xs font-semibold uppercase tracking-wide text-ink/40">
          Baseline studies
        </h4>
        <div className="mt-2">
          <StudyRowsEditor studies={studies} onChange={setStudies} />
        </div>

        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            onClick={() => void saveMonitor()}
            disabled={creating}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {creating ? "Saving…" : "Create monitor"}
          </button>
          {createdNotice ? (
            <span className="text-sm text-emerald-700">{createdNotice}</span>
          ) : null}
        </div>
        {createError ? (
          <p className="mt-2 text-sm text-red-700" role="alert">
            {createError}
          </p>
        ) : null}
      </div>

      {/* Candidate + assess */}
      <div className="rounded-lg border border-ink/15 bg-white p-4">
        <h3 className="text-sm font-semibold text-ink/70">New evidence lands</h3>
        <p className="mt-1 text-xs text-ink/40">
          Add the candidate study and re-pool. The verdict is decided by the cumulative
          meta-analysis — no LLM.
        </p>
        <div className="mt-3">
          <StudyRowsEditor studies={candidate} onChange={(next) => setCandidate([next[0] ?? candidate[0]])} />
        </div>
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={() => void runAssess()}
            disabled={assessing}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {assessing ? "Re-pooling…" : "Assess flip"}
          </button>
        </div>
        {assessError ? <ErrorBanner message={assessError} /> : null}
      </div>

      {assessing ? (
        <LoadingBanner message="Re-pooling the evidence in time order…" />
      ) : assessment ? (
        <div className="space-y-6">
          <div className="rounded-lg border border-ink/15 bg-white p-4">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-ink/70">Flip verdict</h3>
              <FlipVerdictBadge verdict={assessment.verdict} />
            </div>
            <p className="mt-2 text-sm text-ink/70">{assessment.rationale}</p>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div className="rounded-md border border-ink/10 p-3">
                <div className="text-xs uppercase tracking-wide text-ink/40">Before candidate</div>
                <div className="mt-1 tabular-nums text-ink">
                  {assessment.baseline
                    ? `${assessment.baseline.point} [${assessment.baseline.ciLower}, ${assessment.baseline.ciUpper}]`
                    : "not poolable"}
                </div>
                <div className="mt-1 text-xs text-ink/50">
                  {assessment.baselineDirection}
                  {assessment.baseline
                    ? assessment.baselineSignificant
                      ? " · significant"
                      : " · n.s."
                    : ""}
                </div>
              </div>
              <div className="rounded-md border border-ink/10 p-3">
                <div className="text-xs uppercase tracking-wide text-ink/40">After candidate</div>
                <div className="mt-1 tabular-nums text-ink">
                  {assessment.updated
                    ? `${assessment.updated.point} [${assessment.updated.ciLower}, ${assessment.updated.ciUpper}]`
                    : "not poolable"}
                </div>
                <div className="mt-1 text-xs text-ink/50">
                  {assessment.updatedDirection}
                  {assessment.updated
                    ? assessment.updatedSignificant
                      ? " · significant"
                      : " · n.s."
                    : ""}
                </div>
              </div>
            </div>
          </div>

          <CumulativeTimeline cumulative={assessment.cumulative} />
        </div>
      ) : null}

      {/* Existing monitors */}
      <section>
        <h3 className="mb-3 text-sm font-semibold text-ink/70">
          Monitors ({monitors.length})
        </h3>
        {monitorsError ? (
          <ErrorBanner message={monitorsError} />
        ) : monitors.length === 0 ? (
          <div className="rounded-lg border border-ink/15 bg-white p-6 text-center text-sm text-ink/40">
            No monitors yet. Create one above to start watching a claim.
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {monitors.map((m) => (
              <div key={m.id} className="rounded-lg border border-ink/15 bg-white p-4">
                <div className="text-sm font-medium text-ink">{m.topic}</div>
                {m.query ? <div className="mt-1 text-xs text-ink/50">{m.query}</div> : null}
                <div className="mt-2 text-xs text-ink/40">
                  {m.baseline?.length ?? 0} baseline stud
                  {(m.baseline?.length ?? 0) === 1 ? "y" : "ies"} ·{" "}
                  {m.lastCheckedAt
                    ? `checked ${new Date(m.lastCheckedAt).toLocaleDateString()}`
                    : "never checked"}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
