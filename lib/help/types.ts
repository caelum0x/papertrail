import { z } from "zod";

// Domain types + input schemas for the Help center / support / feedback module.
// Every LLM-free boundary still validates request bodies with zod before use.

export const TICKET_STATUSES = ["open", "pending", "resolved", "closed"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const TICKET_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

export const FEEDBACK_KINDS = ["bug", "idea", "praise", "other"] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

// --- Domain models (camelCase, serialized to the client) ---------------------

export interface HelpArticle {
  id: string;
  orgId: string;
  slug: string;
  title: string;
  body: string;
  category: string;
  createdAt: string;
}

export interface HelpCategory {
  category: string;
  count: number;
}

export interface SupportTicket {
  id: string;
  orgId: string;
  userId: string;
  subject: string;
  body: string;
  status: TicketStatus;
  priority: TicketPriority;
  createdAt: string;
  authorName?: string | null;
  authorEmail?: string | null;
  messageCount?: number;
}

export interface TicketMessage {
  id: string;
  orgId: string;
  ticketId: string;
  authorId: string;
  body: string;
  createdAt: string;
  authorName?: string | null;
  authorEmail?: string | null;
}

export interface FeedbackEntry {
  id: string;
  orgId: string;
  userId: string;
  kind: FeedbackKind;
  message: string;
  createdAt: string;
}

// --- Input schemas -----------------------------------------------------------

export const createTicketSchema = z.object({
  subject: z.string().trim().min(3, "Subject must be at least 3 characters.").max(200),
  body: z.string().trim().min(5, "Please describe your issue (5+ characters).").max(10000),
  priority: z.enum(TICKET_PRIORITIES).optional(),
});
export type CreateTicketInput = z.infer<typeof createTicketSchema>;

export const updateTicketSchema = z
  .object({
    status: z.enum(TICKET_STATUSES).optional(),
    priority: z.enum(TICKET_PRIORITIES).optional(),
  })
  .refine((v) => v.status !== undefined || v.priority !== undefined, {
    message: "Provide status or priority to update.",
  });
export type UpdateTicketInput = z.infer<typeof updateTicketSchema>;

export const createMessageSchema = z.object({
  body: z.string().trim().min(1, "Message cannot be empty.").max(10000),
});
export type CreateMessageInput = z.infer<typeof createMessageSchema>;

export const createFeedbackSchema = z.object({
  kind: z.enum(FEEDBACK_KINDS),
  message: z.string().trim().min(3, "Feedback must be at least 3 characters.").max(5000),
});
export type CreateFeedbackInput = z.infer<typeof createFeedbackSchema>;
