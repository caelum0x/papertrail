"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  fetchSrProject,
  fetchRecords,
  importRecords,
  screenRecord,
} from "../client";
import type {
  SrProjectWithCounts,
  SrRecord,
} from "@/app/api/sr-projects/lib/types";
import { InclusionCriteria } from "../_components/InclusionCriteria";
import { ImportPanel } from "../_components/ImportPanel";
import { StageTabs, STAGE_TABS } from "../_components/StageTabs";
import { RecordCard } from "../_components/RecordCard";
import { Pagination } from "../_components/Pagination";

const PAGE_SIZE = 20;

export default function ScreeningQueuePage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const [project, setProject] = useState<SrProjectWithCounts | null>(null);
  const [projectError, setProjectError] = useState<string | null>(null);

  const [tab, setTab] = useState<"title" | "fulltext">("title");
  const [records, setRecords] = useState<SrRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [actingId, setActingId] = useState<string | null>(null);
  const [reasonById, setReasonById] = useState<Record<string, string>>({});
  const [actionError, setActionError] = useState<string | null>(null);

  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState("");
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);

  const activeTab = STAGE_TABS.find((t) => t.key === tab) ?? STAGE_TABS[0];

  const loadProject = useCallback(async () => {
    if (!id) return;
    const result = await fetchSrProject(id);
    if (result.error || !result.data) {
      setProjectError(result.error ?? "Systematic review not found.");
    } else {
      setProject(result.data);
      setProjectError(null);
    }
  }, [id]);

  const loadRecords = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    const result = await fetchRecords(id, activeTab.status, page, PAGE_SIZE);
    if (result.error) {
      setError(result.error);
      setRecords([]);
      setTotal(0);
    } else {
      setRecords(result.data ?? []);
      setTotal(result.total);
    }
    setLoading(false);
  }, [id, activeTab.status, page]);

  useEffect(() => {
    loadProject();
  }, [loadProject]);

  useEffect(() => {
    loadRecords();
  }, [loadRecords]);

  const onScreen = useCallback(
    async (record: SrRecord, decision: "include" | "exclude") => {
      if (!id) return;
      const reason = reasonById[record.id]?.trim() || null;
      if (decision === "exclude" && !reason) {
        setActionError("A reason is required to exclude a record.");
        return;
      }
      setActingId(record.id);
      setActionError(null);
      const result = await screenRecord(
        record.id,
        activeTab.stage,
        decision,
        reason
      );
      setActingId(null);
      if (result.error || !result.data) {
        setActionError(result.error ?? "Failed to record decision.");
        return;
      }
      // Record leaves this queue; drop it locally and refresh counts.
      setRecords((rs) => rs.filter((r) => r.id !== record.id));
      setTotal((t) => Math.max(0, t - 1));
      setReasonById((m) => {
        const next = { ...m };
        delete next[record.id];
        return next;
      });
      loadProject();
    },
    [id, reasonById, activeTab.stage, loadProject]
  );

  const onImport = useCallback(async () => {
    if (!id) return;
    const lines = importText
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) {
      setImportMsg("Enter at least one title.");
      return;
    }
    setImporting(true);
    setImportMsg(null);
    const result = await importRecords(
      id,
      lines.map((title) => ({
        sourceType: "manual",
        externalId: null,
        title,
        abstract: null,
      }))
    );
    setImporting(false);
    if (result.error || !result.data) {
      setImportMsg(result.error ?? "Failed to import records.");
      return;
    }
    setImportMsg(
      `Imported ${result.data.imported} record(s)` +
        (result.data.duplicates > 0
          ? `, skipped ${result.data.duplicates} duplicate(s).`
          : ".")
    );
    setImportText("");
    setPage(1);
    loadRecords();
    loadProject();
  }, [id, importText, loadRecords, loadProject]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  if (projectError) {
    return (
      <div className="max-w-3xl">
        <Link
          href="/console/screening"
          className="text-sm text-accent hover:underline"
        >
          ← Back to reviews
        </Link>
        <div className="mt-6 rounded-lg border border-ink/15 bg-white p-8 text-center">
          <p className="text-sm text-red-700">{projectError}</p>
          <button
            onClick={loadProject}
            className="mt-3 text-sm text-accent hover:underline"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <Link
        href="/console/screening"
        className="text-sm text-accent hover:underline"
      >
        ← Back to reviews
      </Link>

      <div className="mt-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-ink/80">
            {project?.name ?? "Screening"}
          </h1>
          {project ? (
            <p className="mt-1 text-sm text-ink/40">{project.question}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 gap-2">
          {id ? (
            <Link
              href={`/console/screening/${id}/included`}
              className="rounded-md border border-ink/15 bg-white px-4 py-2 text-sm text-ink/80 hover:bg-paper"
            >
              Included
            </Link>
          ) : null}
          {id ? (
            <Link
              href={`/console/screening/${id}/prisma`}
              className="rounded-md border border-ink/15 bg-white px-4 py-2 text-sm text-ink/80 hover:bg-paper"
            >
              PRISMA flow
            </Link>
          ) : null}
          <button
            onClick={() => setShowImport((s) => !s)}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white"
          >
            {showImport ? "Cancel" : "Import records"}
          </button>
        </div>
      </div>

      {project ? (
        <InclusionCriteria criteria={project.inclusionCriteria} />
      ) : null}

      {showImport ? (
        <ImportPanel
          text={importText}
          onTextChange={setImportText}
          onImport={onImport}
          importing={importing}
          message={importMsg}
        />
      ) : null}

      <StageTabs
        active={tab}
        onSelect={(key) => {
          setTab(key);
          setPage(1);
          setActionError(null);
        }}
      />

      {actionError ? (
        <p className="mt-3 text-sm text-red-700">{actionError}</p>
      ) : null}

      <div className="mt-4 space-y-3">
        {loading ? (
          <div className="rounded-lg border border-ink/15 bg-white p-8 text-center text-sm text-ink/40">
            Loading queue...
          </div>
        ) : error ? (
          <div className="rounded-lg border border-ink/15 bg-white p-8 text-center">
            <p className="text-sm text-red-700">{error}</p>
            <button
              onClick={loadRecords}
              className="mt-3 text-sm text-accent hover:underline"
            >
              Try again
            </button>
          </div>
        ) : records.length === 0 ? (
          <div className="rounded-lg border border-ink/15 bg-white p-8 text-center text-sm text-ink/40">
            {activeTab.key === "title"
              ? "No records pending title/abstract screening. Import candidates to begin."
              : "No records awaiting full-text assessment."}
          </div>
        ) : (
          records.map((r) => (
            <RecordCard
              key={r.id}
              record={r}
              reason={reasonById[r.id] ?? ""}
              onReasonChange={(value) =>
                setReasonById((m) => ({ ...m, [r.id]: value }))
              }
              onScreen={(decision) => onScreen(r, decision)}
              acting={actingId === r.id}
            />
          ))
        )}
      </div>

      {!loading && !error && total > PAGE_SIZE ? (
        <Pagination
          page={page}
          totalPages={totalPages}
          total={total}
          unitLabel="in queue"
          onPrev={() => setPage((p) => Math.max(1, p - 1))}
          onNext={() => setPage((p) => Math.min(totalPages, p + 1))}
        />
      ) : null}
    </div>
  );
}
