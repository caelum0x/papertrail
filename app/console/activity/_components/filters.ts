import type { CollabEntityType } from "@/components/collaboration/client";

// Shared filter option lists for the activity module. Kept as data so both the
// feed page and the per-entity sub-page render consistent controls.

export const ENTITY_FILTERS: { value: "" | CollabEntityType; label: string }[] = [
  { value: "", label: "All" },
  { value: "claim", label: "Claims" },
  { value: "document", label: "Documents" },
  { value: "verification", label: "Verifications" },
  { value: "review", label: "Reviews" },
];

export const VERB_FILTERS: { value: string; label: string }[] = [
  { value: "", label: "All actions" },
  { value: "commented", label: "Comments" },
  { value: "replied", label: "Replies" },
  { value: "annotated", label: "Annotations" },
];

const ENTITY_LABELS: Record<string, string> = {
  claim: "Claims",
  document: "Documents",
  verification: "Verifications",
  review: "Reviews",
};

export function entityLabel(entity: CollabEntityType): string {
  return ENTITY_LABELS[entity] ?? entity;
}
