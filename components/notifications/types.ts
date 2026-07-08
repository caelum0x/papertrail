// Client-side view models for the notifications module. Mirrors the camelCase
// shapes returned by the API (see lib/notify.ts) without importing server code
// into the client bundle.

export interface NotificationView {
  id: string;
  orgId: string;
  userId: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

// Human-readable labels for the built-in notification types. Unknown types fall
// back to a title-cased version of the raw type string.
const TYPE_LABELS: Record<string, string> = {
  review_assigned: "Review assigned",
  review_decided: "Review decided",
  claim_verified: "Claim verified",
  document_processed: "Document processed",
  member_invited: "Member invited",
  export_ready: "Export ready",
  system: "System",
};

export function labelForType(type: string): string {
  const known = TYPE_LABELS[type];
  if (known) return known;
  return type
    .split(/[_\s]+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

// Relative "time ago" formatting for the feed and bell dropdown.
export function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}
