// Shared, pure helpers for parsing/clamping pagination params from route handlers.
// Keeps clamp logic in one place so limit/offset semantics stay consistent.

export interface Pagination {
  limit: number;
  offset: number;
}

export interface ParsePaginationOptions {
  defaultLimit: number;
  maxLimit?: number;
  minLimit?: number;
}

// Parse ?limit=&offset= from a URLSearchParams. Invalid/missing values fall back
// to the default; limit is clamped to [minLimit, maxLimit], offset to >= 0.
export function parsePagination(
  params: URLSearchParams,
  { defaultLimit, maxLimit = 100, minLimit = 1 }: ParsePaginationOptions
): Pagination {
  const limit = clampInt(params.get("limit"), defaultLimit, minLimit, maxLimit);
  const offset = clampInt(params.get("offset"), 0, 0, Number.MAX_SAFE_INTEGER);
  return { limit, offset };
}

function clampInt(
  raw: string | null,
  fallback: number,
  min: number,
  max: number
): number {
  if (raw === null) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    return fallback;
  }
  if (parsed < min) {
    return min;
  }
  if (parsed > max) {
    return max;
  }
  return parsed;
}
