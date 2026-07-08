import { z } from "zod";

// Domain types and validation schemas for the Announcements, releases &
// changelog module. Every request body is validated at the API boundary with
// zod before use — never trust raw JSON.

// Kinds categorize an announcement so the UI can badge/color it. Kept as a
// text column at the DB level but validated to this allow-list at the boundary.
export type AnnouncementKind =
  | "general"
  | "feature"
  | "maintenance"
  | "policy"
  | "security";

export const ANNOUNCEMENT_KINDS: readonly AnnouncementKind[] = [
  "general",
  "feature",
  "maintenance",
  "policy",
  "security",
];

// Audience narrows who an announcement targets. "all" is every member; the
// role audiences let an admin post something only admins/owners should see.
export type AnnouncementAudience = "all" | "admins" | "owners";

export const ANNOUNCEMENT_AUDIENCES: readonly AnnouncementAudience[] = [
  "all",
  "admins",
  "owners",
];

export interface Announcement {
  id: string;
  orgId: string;
  title: string;
  body: string;
  kind: AnnouncementKind;
  audience: AnnouncementAudience;
  publishedAt: string | null;
  createdBy: string | null;
  createdAt: string;
  // Enrichment (present on list/detail reads, not on the raw row):
  authorName?: string | null;
  authorEmail?: string | null;
  read?: boolean;
}

export interface Release {
  id: string;
  orgId: string;
  version: string;
  notes: string;
  releasedAt: string;
  createdAt: string;
}

export interface AnnouncementRead {
  id: string;
  orgId: string;
  userId: string;
  announcementId: string;
  readAt: string;
  createdAt: string;
}

// --- Validation schemas -----------------------------------------------------

const titleField = z
  .string()
  .trim()
  .min(1, "Title is required.")
  .max(200, "Title is too long.");

const bodyField = z
  .string()
  .trim()
  .min(1, "Body is required.")
  .max(20000, "Body is too long.");

const kindField = z.enum([
  "general",
  "feature",
  "maintenance",
  "policy",
  "security",
]);

const audienceField = z.enum(["all", "admins", "owners"]);

export const createAnnouncementSchema = z.object({
  title: titleField,
  body: bodyField,
  kind: kindField.optional(),
  audience: audienceField.optional(),
  // Allow creating already-published (skips the draft step) via publish=true.
  publish: z.boolean().optional(),
});

// PATCH: all fields optional, but at least one must be present.
export const updateAnnouncementSchema = z
  .object({
    title: titleField.optional(),
    body: bodyField.optional(),
    kind: kindField.optional(),
    audience: audienceField.optional(),
  })
  .refine(
    (v) =>
      v.title !== undefined ||
      v.body !== undefined ||
      v.kind !== undefined ||
      v.audience !== undefined,
    { message: "No fields to update." }
  );

const versionField = z
  .string()
  .trim()
  .min(1, "Version is required.")
  .max(60, "Version is too long.");

const notesField = z
  .string()
  .trim()
  .max(20000, "Notes are too long.");

export const createReleaseSchema = z.object({
  version: versionField,
  notes: notesField.optional(),
  // ISO datetime string; defaults to now() at the DB when omitted.
  releasedAt: z.string().datetime().optional(),
});

export type CreateAnnouncementInput = z.infer<typeof createAnnouncementSchema>;
export type UpdateAnnouncementInput = z.infer<typeof updateAnnouncementSchema>;
export type CreateReleaseInput = z.infer<typeof createReleaseSchema>;
