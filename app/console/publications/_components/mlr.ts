import type { MlrDecision, MlrRole } from "@/app/api/publications/lib/types";

// MLR role/decision option lists and label helpers shared by the detail page's
// readiness panel and review form.

export const MLR_ROLES: { value: MlrRole; label: string }[] = [
  { value: "medical", label: "Medical" },
  { value: "legal", label: "Legal" },
  { value: "regulatory", label: "Regulatory" },
  { value: "editorial", label: "Editorial" },
];

export const MLR_DECISIONS: { value: MlrDecision; label: string }[] = [
  { value: "approved", label: "Approve" },
  { value: "changes_requested", label: "Request changes" },
  { value: "rejected", label: "Reject" },
];

export function decisionLabel(decision: string | null): string {
  switch (decision) {
    case "approved":
      return "Approved";
    case "rejected":
      return "Rejected";
    case "changes_requested":
      return "Changes requested";
    default:
      return "Pending";
  }
}

export function roleLabel(role: string): string {
  const found = MLR_ROLES.find((r) => r.value === role);
  return found ? found.label : role;
}
