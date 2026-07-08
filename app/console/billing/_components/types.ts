// Shared billing view types + formatters, extracted so the page, its
// presentational components, and the overview sub-page all agree on shape.

export interface Subscription {
  id: string;
  planKey: string;
  planName: string;
  priceCents: number;
  status: string;
  seats: number;
  currentPeriodEnd: string | null;
  createdAt: string;
}

export interface UsageMeter {
  kind: string;
  used: number;
  limit: number | null;
  ratio: number;
}

export interface UsageSummary {
  periodStart: string;
  periodEnd: string | null;
  meters: UsageMeter[];
}

export interface Invoice {
  id: string;
  amountCents: number;
  status: string;
  periodStart: string;
  periodEnd: string;
  createdAt: string;
}

export function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
