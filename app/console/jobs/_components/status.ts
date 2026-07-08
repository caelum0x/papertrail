import type { JobStatus } from "@/lib/jobs/types";

// Shared status badge styling and time formatting for the jobs console.

export function statusClasses(status: JobStatus): string {
  switch (status) {
    case "completed":
      return "bg-green-50 text-green-700 border-green-200";
    case "failed":
      return "bg-red-50 text-red-700 border-red-200";
    case "running":
      return "bg-blue-50 text-blue-700 border-blue-200";
    default:
      return "bg-paper text-ink/60 border-ink/15";
  }
}

export function formatTime(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}
