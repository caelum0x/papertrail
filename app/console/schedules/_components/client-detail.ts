// There is no GET /api/schedules/[id] route; the detail sub-page reuses the
// existing list endpoint and finds the schedule by id (org schedule lists are
// small). This mirrors the monitoring module's fetch-then-find approach.

import type { Schedule } from "@/lib/jobs/types";
import { fetchSchedules } from "./client";

export async function fetchScheduleById(
  id: string
): Promise<{ data: Schedule | null; error: string | null }> {
  const result = await fetchSchedules({ page: 1, limit: 200 });
  if (result.error) {
    return { data: null, error: result.error };
  }
  const found = result.data.find((s) => s.id === id) ?? null;
  return {
    data: found,
    error: found ? null : "Schedule not found.",
  };
}
