import { z } from "zod";

// Input validation for the admin module. All LLM/user input crosses a system
// boundary here and must be validated before touching the database.

// Filters for GET /api/audit (all optional; combined with AND).
export const auditFilterSchema = z.object({
  action: z.string().trim().min(1).max(120).optional(),
  entityType: z.string().trim().min(1).max(120).optional(),
  userId: z.string().uuid().optional(),
});

export type AuditFilter = z.infer<typeof auditFilterSchema>;

// Body for POST /api/api-keys — only a human-readable name is accepted; the
// secret is generated server-side.
export const createApiKeySchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(80),
});

export type CreateApiKeyInput = z.infer<typeof createApiKeySchema>;
