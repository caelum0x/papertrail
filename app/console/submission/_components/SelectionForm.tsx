"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ApiResponse } from "@/lib/api/response";
import type { EvidenceReportListItem } from "./types";

// Selection panel for the submission-bundle console: pick ONE org evidence report
// (loaded from the org-scoped /api/evidence-reports list) and/or paste verification
// ids. Purely a selection surface — it owns no manifest state; it emits the chosen
// inputs to the parent, which calls /api/submission/bundle. House theme tokens only.

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Split a free-text field on commas / whitespace / newlines into candidate ids.
function parseIds(raw: string): string[] {
  return raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export interface SelectionValue {
  verificationIds: string[];
  evidenceReportId: string | null;
}

interface SelectionFormProps {
  onAssemble: (value: SelectionValue) => void;
  assembling: boolean;
}

interface RecentVerification {
  id: string;
  claim_text?: string;
  discrepancy_type?: string | null;
  trust_score?: number | null;
}

export function SelectionForm({ onAssemble, assembling }: SelectionFormProps) {
  const [reports, setReports] = useState<EvidenceReportListItem[]>([]);
  const [reportsLoading, setReportsLoading] = useState(true);
  const [reportsError, setReportsError] = useState<string | null>(null);
  const [selectedReport, setSelectedReport] = useState<string>("");
  const [verificationRaw, setVerificationRaw] = useState("");
  const [recent, setRecent] = useState<RecentVerification[]>([]);

  // Recent verifications are a global (non-org) resource — surface them as a click-to-add
  // picker so a user does not have to know raw UUIDs.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/verifications?limit=15");
        const body = (await res.json().catch(() => null)) as
          | { items?: RecentVerification[] }
          | null;
        if (active && body?.items) setRecent(body.items);
      } catch {
        /* non-fatal: the paste field still works */
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const addVerification = useCallback((id: string) => {
    setVerificationRaw((prev) => {
      const existing = parseIds(prev);
      if (existing.includes(id)) return prev;
      return existing.length > 0 ? `${prev.trim()}\n${id}` : id;
    });
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/evidence-reports?limit=50");
        const body = (await res.json().catch(() => null)) as
          | ApiResponse<EvidenceReportListItem[]>
          | null;
        if (!active) return;
        if (!body || !res.ok || !body.success || !body.data) {
          throw new Error(body?.error ?? "Couldn't load evidence reports.");
        }
        setReports(body.data);
      } catch (err) {
        if (!active) return;
        setReportsError(
          err instanceof Error ? err.message : "Couldn't load evidence reports."
        );
      } finally {
        if (active) setReportsLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const ids = useMemo(() => parseIds(verificationRaw), [verificationRaw]);
  const invalidIds = useMemo(
    () => ids.filter((id) => !UUID_RE.test(id)),
    [ids]
  );
  const validIds = useMemo(
    () => ids.filter((id) => UUID_RE.test(id)),
    [ids]
  );

  const canAssemble =
    !assembling &&
    invalidIds.length === 0 &&
    (validIds.length > 0 || selectedReport !== "");

  const assemble = useCallback(() => {
    if (!canAssemble) return;
    onAssemble({
      verificationIds: validIds,
      evidenceReportId: selectedReport === "" ? null : selectedReport,
    });
  }, [canAssemble, onAssemble, validIds, selectedReport]);

  return (
    <div className="rounded-lg border border-ink/15 bg-white p-4">
      {/* Evidence report picker */}
      <div>
        <label
          className="block text-sm font-medium text-ink/70"
          htmlFor="evidence-report"
        >
          Evidence report
        </label>
        {reportsLoading ? (
          <p className="mt-1 text-xs text-ink/40">Loading evidence reports…</p>
        ) : reportsError ? (
          <p className="mt-1 text-xs text-red-700" role="alert">
            {reportsError}
          </p>
        ) : (
          <select
            id="evidence-report"
            value={selectedReport}
            onChange={(e) => setSelectedReport(e.target.value)}
            className="mt-1 w-full rounded-md border border-ink/15 bg-white px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none"
          >
            <option value="">None</option>
            {reports.map((r) => (
              <option key={r.id} value={r.id}>
                {r.claim.length > 80 ? `${r.claim.slice(0, 80)}…` : r.claim}
                {r.certainty ? ` — ${r.certainty.replace(/_/g, " ")}` : ""}
              </option>
            ))}
          </select>
        )}
        <p className="mt-1 text-xs text-ink/40">
          Contributes the pooled estimate, GRADE certainty, and synthesis verdict.
        </p>
      </div>

      {/* Recent verifications — click to add */}
      {recent.length > 0 ? (
        <div className="mt-4">
          <span className="block text-sm font-medium text-ink/70">Recent verifications</span>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {recent.map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => addVerification(v.id)}
                title={v.claim_text ?? v.id}
                className="max-w-[16rem] truncate rounded-md border border-ink/15 px-2 py-1 text-xs text-ink/70 hover:border-accent hover:text-accent"
              >
                + {v.claim_text ? (v.claim_text.length > 40 ? `${v.claim_text.slice(0, 40)}…` : v.claim_text) : v.id.slice(0, 8)}
                {v.discrepancy_type ? ` (${v.discrepancy_type.replace(/_/g, " ")})` : ""}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {/* Verification ids */}
      <div className="mt-4">
        <label
          className="block text-sm font-medium text-ink/70"
          htmlFor="verification-ids"
        >
          Verification ids
        </label>
        <textarea
          id="verification-ids"
          rows={3}
          value={verificationRaw}
          onChange={(e) => setVerificationRaw(e.target.value)}
          placeholder="Paste verification UUIDs, separated by commas or new lines."
          className="mt-1 w-full rounded-md border border-ink/15 bg-white px-3 py-2 font-mono text-xs text-ink focus:border-accent focus:outline-none"
        />
        <p className="mt-1 text-xs text-ink/40">
          {validIds.length} valid id{validIds.length === 1 ? "" : "s"}
          {invalidIds.length > 0 ? (
            <span className="text-red-700">
              {" "}
              · {invalidIds.length} not a valid UUID
            </span>
          ) : null}
          . Each contributes its verdict, trust score, and grounded chain of custody.
        </p>
      </div>

      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={assemble}
          disabled={!canAssemble}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {assembling ? "Assembling…" : "Assemble bundle"}
        </button>
      </div>
    </div>
  );
}
