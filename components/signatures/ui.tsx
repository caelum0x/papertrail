"use client";

import type { RequestStatus, SignerStatus } from "@/lib/signatures/types";

// Small shared presentational primitives for the signatures views: status
// pills, loading / empty / error states, and time formatting. Colocated so the
// module owns its own display vocabulary.

export function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const diff = Date.now() - then;
  const s = Math.round(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

const REQUEST_STATUS_STYLES: Record<RequestStatus, string> = {
  draft: "bg-paper text-ink/50 border-ink/10",
  pending: "bg-amber-50 text-amber-700 border-amber-200",
  completed: "bg-emerald-50 text-emerald-700 border-emerald-200",
  cancelled: "bg-ink/5 text-ink/40 border-ink/10 line-through",
};

const REQUEST_STATUS_LABELS: Record<RequestStatus, string> = {
  draft: "Draft",
  pending: "Awaiting signatures",
  completed: "Completed",
  cancelled: "Cancelled",
};

export function RequestStatusBadge({ status }: { status: RequestStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${REQUEST_STATUS_STYLES[status]}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {REQUEST_STATUS_LABELS[status]}
    </span>
  );
}

export function SignerStatusBadge({ status }: { status: SignerStatus }) {
  const signed = status === "signed";
  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide ${
        signed
          ? "bg-emerald-50 text-emerald-700 border-emerald-200"
          : "bg-paper text-ink/50 border-ink/10"
      }`}
    >
      {signed ? "Signed" : "Pending"}
    </span>
  );
}

export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-sm text-ink/40">
      <span className="h-3 w-3 animate-spin rounded-full border-2 border-ink/20 border-t-accent" />
      {label}
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-5 text-sm text-red-700">
      <p>{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-3 rounded border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100"
        >
          Retry
        </button>
      )}
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-dashed border-ink/10 bg-white p-10 text-center">
      <p className="text-sm font-medium text-ink/60">{title}</p>
      {hint && <p className="mt-1 text-xs text-ink/40">{hint}</p>}
    </div>
  );
}

export function EntityChip({
  entityType,
  entityId,
}: {
  entityType: string;
  entityId: string;
}) {
  return (
    <code className="rounded bg-paper px-1.5 py-0.5 font-mono text-xs text-ink/70">
      {entityType}/{entityId.slice(0, 8)}
    </code>
  );
}

export function HashChip({ value }: { value: string }) {
  return (
    <code className="break-all rounded bg-paper px-1.5 py-0.5 font-mono text-xs text-ink/70">
      {value}
    </code>
  );
}
