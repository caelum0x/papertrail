const HISTORY_KEY = "papertrail:history";
const DEFAULT_CAP = 10;

/**
 * Merge a claim into an existing history list.
 *
 * Pure: returns a new array, never mutates the input. Newest first,
 * case-insensitive dedupe (existing entries matching the new claim are
 * dropped so the freshly-added one takes its place), capped to `cap`.
 */
export function mergeHistory(
  existing: string[],
  claim: string,
  cap: number = DEFAULT_CAP,
): string[] {
  const trimmed = claim.trim();
  if (trimmed.length === 0) return existing.slice(0, Math.max(0, cap));

  const key = trimmed.toLowerCase();
  const withoutDupes = existing.filter(
    (entry) => entry.trim().toLowerCase() !== key,
  );

  return [trimmed, ...withoutDupes].slice(0, Math.max(0, cap));
}

function hasWindow(): boolean {
  return typeof window !== "undefined";
}

/**
 * Read the local claim history. SSR-safe and never throws — returns []
 * when storage is unavailable, empty, or holds malformed data.
 */
export function getLocalHistory(): string[] {
  if (!hasWindow()) return [];

  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];

    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter(
      (entry): entry is string =>
        typeof entry === "string" && entry.trim().length > 0,
    );
  } catch {
    return [];
  }
}

/**
 * Add a claim to the local history. SSR-safe and never throws.
 */
export function addLocalHistory(claim: string): void {
  if (!hasWindow()) return;

  try {
    const next = mergeHistory(getLocalHistory(), claim);
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  } catch {
    // Storage may be full or disabled (private mode); fail silently.
  }
}

/**
 * Clear the local history. SSR-safe and never throws.
 */
export function clearLocalHistory(): void {
  if (!hasWindow()) return;

  try {
    window.localStorage.removeItem(HISTORY_KEY);
  } catch {
    // Ignore storage errors.
  }
}
