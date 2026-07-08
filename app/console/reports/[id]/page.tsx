"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  deleteReport,
  fetchReport,
  runExport,
} from "@/components/reports-exports/api";
import { useRole } from "@/components/reports-exports/useRole";
import { type ExportFormat } from "@/lib/reports-exports/schemas";
import type { Report } from "@/lib/reports-exports/types";
import { TYPE_LABELS } from "../_components/shared";
import { ReportSummary } from "../_components/ReportSummary";
import { RunReportCard } from "../_components/RunReportCard";

export default function ReportDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id;
  const { canEdit } = useRole();

  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [format, setFormat] = useState<ExportFormat>("csv");
  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState<string | null>(null);
  const [exportErr, setExportErr] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    const result = await fetchReport(id);
    if (result.error) {
      setError(result.error);
      setReport(null);
    } else {
      setReport(result.data);
      const cfgFormat = result.data?.config?.format;
      if (cfgFormat === "csv" || cfgFormat === "markdown") setFormat(cfgFormat);
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const onRun = async () => {
    if (!report) return;
    setExporting(true);
    setExportMsg(null);
    setExportErr(null);
    const result = await runExport({
      type: report.type,
      format,
      project_id: report.project_id,
    });
    setExporting(false);
    if (result.error) {
      setExportErr(result.error);
      return;
    }
    setExportMsg(
      `Exported ${result.rowCount ?? 0} rows to ${result.filename ?? "file"}.`
    );
  };

  const onDelete = async () => {
    if (!id) return;
    setDeleting(true);
    const result = await deleteReport(id);
    setDeleting(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    router.push("/console/reports");
  };

  return (
    <div>
      <Link
        href="/console/reports"
        className="text-sm text-accent hover:underline"
      >
        ← Reports
      </Link>

      {loading ? (
        <div className="mt-6 rounded-lg border border-ink/15 bg-white p-8 text-center text-sm text-ink/40">
          Loading report…
        </div>
      ) : error ? (
        <div className="mt-6 rounded-lg border border-ink/15 bg-white p-8 text-center">
          <p className="text-sm text-red-700">{error}</p>
          <button
            onClick={load}
            className="mt-3 text-sm text-accent hover:underline"
          >
            Try again
          </button>
        </div>
      ) : !report ? (
        <div className="mt-6 rounded-lg border border-ink/15 bg-white p-8 text-center text-sm text-ink/40">
          Report not found.
        </div>
      ) : (
        <>
          <div className="mt-4 flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold text-ink/80">{report.name}</h1>
              <p className="mt-1 text-sm text-ink/40">
                {TYPE_LABELS[report.type]} report
              </p>
            </div>
            {canEdit ? (
              <button
                onClick={onDelete}
                disabled={deleting}
                className="rounded-md border border-ink/15 bg-white px-3 py-1.5 text-sm text-ink/60 hover:text-red-700 disabled:opacity-40"
              >
                {deleting ? "Deleting…" : "Delete report"}
              </button>
            ) : null}
          </div>

          <ReportSummary report={report} />

          <RunReportCard
            report={report}
            canEdit={canEdit}
            format={format}
            exporting={exporting}
            exportMsg={exportMsg}
            exportErr={exportErr}
            onFormatChange={setFormat}
            onRun={onRun}
          />
        </>
      )}
    </div>
  );
}
