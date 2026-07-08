"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  createReport,
  deleteReport,
  fetchExportJobs,
  fetchReports,
  runExport,
} from "@/components/reports-exports/api";
import { useRole } from "@/components/reports-exports/useRole";
import {
  type ExportFormat,
  type ReportType,
} from "@/lib/reports-exports/schemas";
import type { ExportJob, Report } from "@/lib/reports-exports/types";
import { ModuleHeader } from "./_components/ModuleHeader";
import { ExportRunner } from "./_components/ExportRunner";
import { CreateReportForm } from "./_components/CreateReportForm";
import { SavedReportsTable } from "./_components/SavedReportsTable";
import { ExportJobsTable } from "./_components/ExportJobsTable";
import { Pagination } from "./_components/Pagination";

const PAGE_SIZE = 20;

export default function ReportsPage() {
  const { canEdit } = useRole();

  // Saved reports list.
  const [reports, setReports] = useState<Report[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Recent export jobs.
  const [jobs, setJobs] = useState<ExportJob[]>([]);
  const [jobsLoading, setJobsLoading] = useState(true);

  // Create-report form.
  const [name, setName] = useState("");
  const [reportType, setReportType] = useState<ReportType>("verifications");
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Run-export controls.
  const [exportType, setExportType] = useState<ReportType>("verifications");
  const [exportFormat, setExportFormat] = useState<ExportFormat>("csv");
  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState<string | null>(null);
  const [exportErr, setExportErr] = useState<string | null>(null);

  const loadReports = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await fetchReports(page, PAGE_SIZE);
    if (result.error) {
      setError(result.error);
      setReports([]);
      setTotal(0);
    } else {
      setReports(result.data ?? []);
      setTotal(result.total);
    }
    setLoading(false);
  }, [page]);

  const loadJobs = useCallback(async () => {
    setJobsLoading(true);
    const result = await fetchExportJobs(1, 10);
    setJobs(result.error ? [] : result.data ?? []);
    setJobsLoading(false);
  }, []);

  useEffect(() => {
    loadReports();
  }, [loadReports]);

  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

  const onCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setFormError("Report name is required.");
      return;
    }
    setCreating(true);
    setFormError(null);
    const result = await createReport({ name: name.trim(), type: reportType });
    setCreating(false);
    if (result.error) {
      setFormError(result.error);
      return;
    }
    setName("");
    setReportType("verifications");
    setPage(1);
    await loadReports();
  };

  const onDelete = async (id: string) => {
    const result = await deleteReport(id);
    if (result.error) {
      setError(result.error);
      return;
    }
    await loadReports();
  };

  const onRunExport = async () => {
    setExporting(true);
    setExportMsg(null);
    setExportErr(null);
    const result = await runExport({ type: exportType, format: exportFormat });
    setExporting(false);
    if (result.error) {
      setExportErr(result.error);
      return;
    }
    setExportMsg(
      `Exported ${result.rowCount ?? 0} rows to ${result.filename ?? "file"}.`
    );
    await loadJobs();
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <ModuleHeader
        title="Reports & exports"
        description="Save report definitions and export verifications, claims, or evidence to CSV or Markdown."
        actions={
          <Link
            href="/console/reports/history"
            className="rounded-md border border-ink/15 bg-white px-3 py-1.5 text-sm text-ink/60 hover:bg-paper"
          >
            Export history
          </Link>
        }
      />

      <div className="mt-6">
        <ExportRunner
          canEdit={canEdit}
          exportType={exportType}
          exportFormat={exportFormat}
          exporting={exporting}
          exportMsg={exportMsg}
          exportErr={exportErr}
          onTypeChange={setExportType}
          onFormatChange={setExportFormat}
          onRun={onRunExport}
        />
      </div>

      {canEdit ? (
        <div className="mt-4">
          <CreateReportForm
            name={name}
            reportType={reportType}
            creating={creating}
            formError={formError}
            onNameChange={setName}
            onTypeChange={setReportType}
            onSubmit={onCreate}
          />
        </div>
      ) : null}

      {/* Saved reports table */}
      <h2 className="mt-6 text-sm font-semibold text-ink/80">Saved reports</h2>
      <div className="mt-2 overflow-hidden rounded-lg border border-ink/15 bg-white">
        {loading ? (
          <div className="p-8 text-center text-sm text-ink/40">Loading reports…</div>
        ) : error ? (
          <div className="p-8 text-center">
            <p className="text-sm text-red-700">{error}</p>
            <button
              onClick={loadReports}
              className="mt-3 text-sm text-accent hover:underline"
            >
              Try again
            </button>
          </div>
        ) : reports.length === 0 ? (
          <div className="p-8 text-center text-sm text-ink/40">
            No saved reports yet.
          </div>
        ) : (
          <SavedReportsTable
            reports={reports}
            canEdit={canEdit}
            onDelete={onDelete}
          />
        )}
      </div>

      {!loading && !error && total > PAGE_SIZE ? (
        <Pagination
          page={page}
          totalPages={totalPages}
          total={total}
          onPrev={() => setPage((p) => Math.max(1, p - 1))}
          onNext={() => setPage((p) => Math.min(totalPages, p + 1))}
        />
      ) : null}

      {/* Recent export jobs */}
      <h2 className="mt-8 text-sm font-semibold text-ink/80">Recent exports</h2>
      <div className="mt-2 overflow-hidden rounded-lg border border-ink/15 bg-white">
        {jobsLoading ? (
          <div className="p-6 text-center text-sm text-ink/40">Loading…</div>
        ) : jobs.length === 0 ? (
          <div className="p-6 text-center text-sm text-ink/40">
            No exports run yet.
          </div>
        ) : (
          <ExportJobsTable jobs={jobs} />
        )}
      </div>
    </div>
  );
}
