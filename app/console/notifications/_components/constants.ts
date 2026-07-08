// The notification types a recipient can toggle delivery for. Kept in sync with
// NOTIFICATION_TYPES in lib/notify.ts.
export const TOGGLEABLE_TYPES = [
  "review_assigned",
  "review_decided",
  "claim_verified",
  "document_processed",
  "member_invited",
  "export_ready",
] as const;

export const PAGE_SIZE = 20;
