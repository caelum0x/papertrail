import type { ReviewWithPeople } from "@/lib/reviews/types";

// Shared display helpers for the reviews module UI. Colocated with the
// presentational components so the module owns its own formatting.

export function refLabel(review: ReviewWithPeople): string {
  if (review.claimId) return `Claim ${review.claimId.slice(0, 8)}`;
  if (review.projectId) return `Project ${review.projectId.slice(0, 8)}`;
  return "—";
}

export function formatDate(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

export function formatDateTime(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

export const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "All statuses" },
  { value: "pending", label: "Pending" },
  { value: "in_review", label: "In review" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "cancelled", label: "Cancelled" },
];
