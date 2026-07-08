// Shared types for the billing module (plans, subscriptions, usage, invoices).
// These are the JSON shapes returned by the module's /api/billing routes and
// consumed by its console pages. Subscription/usage/invoice data is org-scoped;
// plans are a global catalog.

// A quota limit map: quota kind -> monthly cap. -1 (or a missing kind) means
// unlimited.
export type PlanLimits = Record<string, number>;

// A plan in the global catalog.
export interface Plan {
  id: string;
  key: string;
  name: string;
  limits: PlanLimits;
  priceCents: number;
}

export type SubscriptionStatus =
  | "active"
  | "trialing"
  | "past_due"
  | "canceled";

// An org's current subscription, joined with its plan for display.
export interface Subscription {
  id: string;
  planId: string;
  planKey: string;
  planName: string;
  priceCents: number;
  status: SubscriptionStatus;
  seats: number;
  currentPeriodEnd: string | null;
  createdAt: string;
}

// A single quota meter: how much of a kind's cap has been consumed this period.
export interface UsageMeter {
  kind: string;
  used: number;
  // Plan cap for this kind. null means unlimited.
  limit: number | null;
  // Fraction 0..1 of the cap used (0 when unlimited).
  ratio: number;
}

// The full usage snapshot for the current org's active period.
export interface UsageSummary {
  periodStart: string;
  periodEnd: string | null;
  meters: UsageMeter[];
}

// The result of a pre-spend quota check.
export interface QuotaDecision {
  kind: string;
  allowed: boolean;
  used: number;
  // Plan cap for this kind. null means unlimited.
  limit: number | null;
  remaining: number | null;
}

export type InvoiceStatus = "open" | "paid" | "void" | "uncollectible";

export interface Invoice {
  id: string;
  amountCents: number;
  status: InvoiceStatus;
  periodStart: string;
  periodEnd: string;
  createdAt: string;
}
