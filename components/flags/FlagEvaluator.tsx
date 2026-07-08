"use client";

import { useState } from "react";
import type { FeatureFlag, FlagEvaluation } from "@/lib/flags/types";
import { evaluateFlag } from "@/components/flags/api";

// Side panel to test how a flag resolves for a given subject. Great for the
// demo: type a subject id and see the deterministic on/off result and reason.
const REASON_LABELS: Record<FlagEvaluation["reason"], string> = {
  flag_disabled: "Flag is disabled",
  rule_match_on: "Matched a rule → on",
  rule_match_off: "Matched a rule → off",
  rollout_in: "Inside rollout",
  rollout_out: "Outside rollout",
  flag_not_found: "Flag not found",
};

export function FlagEvaluator({ flag }: { flag: FeatureFlag }) {
  const [subject, setSubject] = useState("");
  const [result, setResult] = useState<FlagEvaluation | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    const trimmed = subject.trim();
    if (!trimmed) {
      setError("Enter a subject id to evaluate.");
      return;
    }
    setLoading(true);
    setError(null);
    const res = await evaluateFlag({ key: flag.key, subject: trimmed });
    setLoading(false);
    if (!res.success || !res.data) {
      setError(res.error ?? "Evaluation failed.");
      setResult(null);
      return;
    }
    setResult(res.data);
  }

  return (
    <section className="rounded-lg border border-ink/10 bg-white p-5">
      <h2 className="text-sm font-semibold text-ink">Test evaluation</h2>
      <p className="mt-1 text-xs text-ink/50">
        Deterministic — the same subject always resolves the same way.
      </p>
      <div className="mt-3 flex gap-2">
        <input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void run();
          }}
          placeholder="subject id (e.g. user-123)"
          className="flex-1 rounded-md border border-ink/10 bg-white px-3 py-1.5 text-sm focus:border-accent focus:outline-none"
        />
        <button
          onClick={run}
          disabled={loading}
          className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-40"
        >
          {loading ? "…" : "Evaluate"}
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      {result && (
        <div className="mt-3 rounded-md border border-ink/10 bg-paper/50 p-3 text-sm">
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${
                result.enabled
                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                  : "bg-paper text-ink/50 border-ink/10"
              }`}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-current" />
              {result.enabled ? "Enabled" : "Disabled"}
            </span>
            <span className="text-xs text-ink/50">
              {REASON_LABELS[result.reason]}
            </span>
          </div>
        </div>
      )}
    </section>
  );
}
