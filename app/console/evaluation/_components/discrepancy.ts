import { DISCREPANCY_OPTIONS } from "../lib";

// Maps a discrepancy_type value to its human-readable label.
export function discrepancyLabel(value: string | null): string {
  if (!value) return "—";
  return DISCREPANCY_OPTIONS.find((o) => o.value === value)?.label ?? value;
}
