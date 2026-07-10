"use client";

import { useCallback, useState } from "react";
import type { ApiResponse } from "@/lib/api/response";
import type { PrismaAutopilotResult } from "@/lib/prisma/autopilot";
import { ModuleHeader } from "../claims/_components/ModuleHeader";
import { LoadingBanner } from "@/components/console/StateBanners";
import { PrismaFlow } from "./_components/PrismaFlow";
import { ScreeningTable } from "./_components/ScreeningTable";
import { EvidencePanel } from "./_components/EvidencePanel";

// PRISMA SYSTEMATIC-REVIEW AUTOPILOT console. Enter a review question + inclusion
// criteria; PaperTrail runs the whole review — finds candidate trials, AI-screens each
// against the criteria (grounded rationales), extracts grounded effects from every
// included record, and synthesises the included body of evidence into one composite,
// GRADE-rated report — and renders the live PRISMA flow (identified → screened →
// included) alongside the synthesised report. Heavy Claude across screening + extraction;
// every number is grounded by the deterministic engines.

const EXAMPLE_QUESTION =
  "Do SGLT2 inhibitors reduce hospitalization for heart failure in adults with type 2 diabetes?";
const EXAMPLE_CRITERIA = [
  "Randomized controlled trial",
  "Adults with type 2 diabetes",
  "Reports hospitalization for heart failure as an outcome",
].join("\n");

export default function PrismaAutopilotPage() {
  const [question, setQuestion] = useState("");
  const [criteria, setCriteria] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PrismaAutopilotResult | null>(null);

  const submit = useCallback(async () => {
    const trimmed = question.trim();
    if (trimmed.length < 10) {
      setError("Enter a review question of at least 10 characters.");
      setResult(null);
      return;
    }
    const criteriaList = criteria
      .split("\n")
      .map((c) => c.trim())
      .filter(Boolean);

    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/prisma/autopilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmed, criteria: criteriaList }),
      });
      const body = (await res.json().catch(() => null)) as
        | ApiResponse<PrismaAutopilotResult>
        | null;
      if (!body) throw new Error("Unexpected server response.");
      if (!res.ok || !body.success || !body.data) {
        throw new Error(body.error ?? "The PRISMA autopilot failed.");
      }
      setResult(body.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to run the review.");
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, [question, criteria]);

  const loadExample = useCallback(() => {
    setQuestion(EXAMPLE_QUESTION);
    setCriteria(EXAMPLE_CRITERIA);
  }, []);

  return (
    <div className="space-y-6">
      <ModuleHeader
        title="PRISMA autopilot"
        subtitle="State a systematic-review question and inclusion criteria — PaperTrail finds candidate trials, AI-screens each against the criteria, extracts grounded effects, and synthesises the included evidence into one GRADE-rated report. Every screening rationale and every number is verified by the engine."
      />

      <div className="rounded-lg border border-ink/15 bg-white p-4">
        <label className="block text-sm font-medium text-ink/70" htmlFor="question">
          Review question
        </label>
        <textarea
          id="question"
          rows={2}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={`e.g. ${EXAMPLE_QUESTION}`}
          className="mt-1 w-full rounded-md border border-ink/15 bg-white px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none"
        />

        <label
          className="mt-4 block text-sm font-medium text-ink/70"
          htmlFor="criteria"
        >
          Inclusion criteria <span className="text-ink/40">(one per line, optional)</span>
        </label>
        <textarea
          id="criteria"
          rows={4}
          value={criteria}
          onChange={(e) => setCriteria(e.target.value)}
          placeholder={"Randomized controlled trial\nAdults with type 2 diabetes\nReports heart-failure hospitalization"}
          className="mt-1 w-full rounded-md border border-ink/15 bg-white px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none"
        />

        <div className="mt-3 flex items-center justify-between">
          <button
            type="button"
            onClick={loadExample}
            className="text-sm font-medium text-accent hover:underline"
          >
            Try an example
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={loading}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {loading ? "Running review…" : "Run PRISMA autopilot"}
          </button>
        </div>
        {error ? (
          <p className="mt-3 text-sm text-red-700" role="alert">
            {error}
          </p>
        ) : null}
      </div>

      {loading ? (
        <LoadingBanner message="Finding candidates, screening abstracts, extracting effects, and synthesising the evidence…" />
      ) : result ? (
        <div className="space-y-4">
          <div className="rounded-lg border border-ink/15 bg-white p-4">
            <h2 className="text-lg font-semibold text-ink/80">{result.question}</h2>
            {result.criteria.length > 0 ? (
              <ul className="mt-2 flex flex-wrap gap-2">
                {result.criteria.map((c, i) => (
                  <li
                    key={i}
                    className="rounded-full bg-ink/5 px-2.5 py-0.5 text-xs text-ink/60"
                  >
                    {c}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <PrismaFlow counts={result.counts} />
            <EvidencePanel
              report={result.report}
              extractedRecords={result.extractedRecords}
            />
          </div>

          <ScreeningTable records={result.screened} />
        </div>
      ) : null}
    </div>
  );
}
