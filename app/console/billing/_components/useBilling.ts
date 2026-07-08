"use client";

import { useCallback, useEffect, useState } from "react";
import { getJson } from "@/components/billing/apiClient";
import type { Invoice, Subscription, UsageSummary } from "./types";

interface BillingState {
  subscription: Subscription | null;
  usage: UsageSummary | null;
  invoices: Invoice[];
  loading: boolean;
  error: string | null;
  reload: () => void;
}

// Loads the org's subscription, usage summary, and invoice history in parallel
// from the existing /api/billing/* endpoints. Shared by the billing overview
// and detail pages so their data-fetching stays identical.
export function useBilling(): BillingState {
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [subRes, usageRes, invRes] = await Promise.all([
      getJson<Subscription | null>("/api/billing/subscription"),
      getJson<UsageSummary>("/api/billing/usage"),
      getJson<Invoice[]>("/api/billing/invoices"),
    ]);
    setLoading(false);
    if (!subRes.success) {
      setError(subRes.error ?? "Failed to load billing.");
      return;
    }
    setSubscription(subRes.data ?? null);
    if (usageRes.success && usageRes.data) setUsage(usageRes.data);
    if (invRes.success && invRes.data) setInvoices(invRes.data);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { subscription, usage, invoices, loading, error, reload: load };
}
