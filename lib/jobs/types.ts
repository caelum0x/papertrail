// Domain types for the job queue and schedules. camelCase shapes returned by
// the repository/queue layer; DB rows are snake_case and mapped in queue.ts.

export const JOB_STATUSES = [
  "queued",
  "running",
  "completed",
  "failed",
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

export interface Job {
  id: string;
  orgId: string;
  type: string;
  payload: Record<string, unknown>;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  runAfter: string;
  lockedAt: string | null;
  result: Record<string, unknown> | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Schedule {
  id: string;
  orgId: string;
  name: string;
  type: string;
  cron: string;
  payload: Record<string, unknown>;
  enabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// Result of processing one tick: how many jobs ran and how many schedules fired.
export interface TickResult {
  processedJobs: number;
  completedJobs: number;
  failedJobs: number;
  firedSchedules: number;
}
