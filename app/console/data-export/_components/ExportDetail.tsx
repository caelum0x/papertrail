import type { DataExport } from "@/lib/dataexport/types";
import { StatusBadge } from "./StatusBadge";
import {
  FORMAT_LABELS,
  SCOPE_DESCRIPTIONS,
  SCOPE_LABELS,
  formatDateTime,
} from "./shared";

interface ExportDetailProps {
  item: DataExport;
}

// DetailHeader + metadata panel for a single export: scope title, status badge,
// and a definition list of format / rows / creator / timestamp.
export function ExportDetail({ item }: ExportDetailProps) {
  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-ink/80">
            {SCOPE_LABELS[item.scope] ?? item.scope} export
          </h1>
          <p className="mt-1 max-w-xl text-sm text-ink/50">
            {SCOPE_DESCRIPTIONS[item.scope] ?? ""}
          </p>
        </div>
        <StatusBadge status={item.status} />
      </div>

      <dl className="mt-5 grid gap-px overflow-hidden rounded-lg border border-ink/15 bg-ink/10 text-sm sm:grid-cols-2">
        <div className="bg-white px-4 py-3">
          <dt className="text-xs uppercase tracking-wide text-ink/40">Format</dt>
          <dd className="mt-1 font-medium text-ink/80">
            {FORMAT_LABELS[item.format] ?? item.format.toUpperCase()}
          </dd>
        </div>
        <div className="bg-white px-4 py-3">
          <dt className="text-xs uppercase tracking-wide text-ink/40">Rows</dt>
          <dd className="mt-1 font-medium text-ink/80">{item.row_count}</dd>
        </div>
        <div className="bg-white px-4 py-3">
          <dt className="text-xs uppercase tracking-wide text-ink/40">
            Created by
          </dt>
          <dd className="mt-1 font-medium text-ink/80">
            {item.created_by_name ?? item.created_by_email ?? "—"}
          </dd>
        </div>
        <div className="bg-white px-4 py-3">
          <dt className="text-xs uppercase tracking-wide text-ink/40">
            Created at
          </dt>
          <dd className="mt-1 font-medium text-ink/80">
            {formatDateTime(item.created_at)}
          </dd>
        </div>
      </dl>
    </div>
  );
}
