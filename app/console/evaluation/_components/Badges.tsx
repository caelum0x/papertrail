import { accuracyClasses, statusClasses } from "../lib";

// Small pill badges used throughout the evaluation tables and cards.

export function AccuracyBadge({
  value,
  label,
}: {
  value: number | null | undefined;
  label: string;
}) {
  return (
    <span
      className={`inline-block rounded-full border px-2 py-0.5 text-xs ${accuracyClasses(
        value
      )}`}
    >
      {label}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-block rounded-full border px-2 py-0.5 text-xs ${statusClasses(
        status
      )}`}
    >
      {status}
    </span>
  );
}

export function PassFailBadge({ passed }: { passed: boolean }) {
  return (
    <span
      className={`inline-block rounded-full border px-2 py-0.5 text-xs ${
        passed
          ? "bg-green-50 text-green-700 border-green-200"
          : "bg-red-50 text-red-700 border-red-200"
      }`}
    >
      {passed ? "PASS" : "FAIL"}
    </span>
  );
}

export function Check({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`rounded border px-1.5 py-0.5 ${
        ok
          ? "bg-green-50 text-green-700 border-green-200"
          : "bg-red-50 text-red-700 border-red-200"
      }`}
    >
      {ok ? "✓" : "✕"} {label}
    </span>
  );
}
