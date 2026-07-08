"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { getJson, sendJson, formatCents } from "@/components/billing/apiClient";
import { useCurrentRole } from "@/components/org-team/useCurrentRole";

interface Plan {
  id: string;
  key: string;
  name: string;
  limits: Record<string, number>;
  priceCents: number;
}

interface Subscription {
  id: string;
  planKey: string;
  planName: string;
  priceCents: number;
  status: string;
  seats: number;
  currentPeriodEnd: string | null;
  createdAt: string;
}

function limitLabel(value: number): string {
  return value < 0 ? "Unlimited" : value.toLocaleString();
}

export default function BillingSettingsPage() {
  const { role, loading: roleLoading } = useCurrentRole();
  const isOwner = role === "owner";

  const [plans, setPlans] = useState<Plan[]>([]);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [pending, setPending] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [plansRes, subRes] = await Promise.all([
      getJson<Plan[]>("/api/billing/plans"),
      getJson<Subscription | null>("/api/billing/subscription"),
    ]);
    setLoading(false);
    if (!plansRes.success || !plansRes.data) {
      setError(plansRes.error ?? "Failed to load plans.");
      return;
    }
    setPlans(plansRes.data);
    if (subRes.success) setSubscription(subRes.data ?? null);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onSubscribe = useCallback(
    async (planKey: string) => {
      setPending(planKey);
      setActionError(null);
      setNotice(null);
      const res = await sendJson<Subscription>(
        "/api/billing/subscribe",
        "POST",
        { planKey }
      );
      setPending(null);
      if (!res.success || !res.data) {
        setActionError(res.error ?? "Failed to update plan.");
        return;
      }
      setSubscription(res.data);
      setNotice(`Switched to ${res.data.planName}.`);
    },
    []
  );

  const currentKey = subscription?.planKey ?? "free";

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink/80">Plan &amp; billing</h1>
          <p className="mt-1 text-sm text-ink/40">
            Choose the plan that fits your team&apos;s verification volume.
          </p>
        </div>
        <Link
          href="/console/billing"
          className="text-sm text-accent hover:underline"
        >
          Usage &amp; invoices
        </Link>
      </div>

      {!roleLoading && !isOwner ? (
        <p className="mt-4 text-sm text-ink/40">
          Only the organization owner can change the billing plan.
        </p>
      ) : null}

      {actionError ? (
        <p className="mt-4 text-sm text-red-600">{actionError}</p>
      ) : null}
      {notice ? <p className="mt-4 text-sm text-ink/60">{notice}</p> : null}

      {loading ? (
        <p className="mt-6 text-sm text-ink/40">Loading plans...</p>
      ) : error ? (
        <p className="mt-6 text-sm text-red-600">{error}</p>
      ) : plans.length === 0 ? (
        <p className="mt-6 text-sm text-ink/40">No plans available.</p>
      ) : (
        <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-4">
          {plans.map((plan) => {
            const isCurrent = plan.key === currentKey;
            const limitKinds = Object.keys(plan.limits).sort();
            return (
              <div
                key={plan.id}
                className={`bg-white border rounded-lg p-5 flex flex-col ${
                  isCurrent ? "border-accent" : "border-ink/10"
                }`}
              >
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-semibold text-ink/80">
                    {plan.name}
                  </h2>
                  {isCurrent ? (
                    <span className="text-xs text-accent">Current</span>
                  ) : null}
                </div>
                <div className="mt-1 text-2xl font-semibold text-ink/80 tabular-nums">
                  {plan.priceCents === 0 ? "Free" : formatCents(plan.priceCents)}
                  {plan.priceCents === 0 ? (
                    ""
                  ) : (
                    <span className="text-sm font-normal text-ink/40">/mo</span>
                  )}
                </div>
                <ul className="mt-4 space-y-1 text-xs text-ink/60 flex-1">
                  {limitKinds.map((kind) => (
                    <li key={kind} className="flex justify-between">
                      <span className="capitalize">
                        {kind.replace(/_/g, " ")}
                      </span>
                      <span className="tabular-nums">
                        {limitLabel(plan.limits[kind])}
                      </span>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  disabled={!isOwner || isCurrent || pending !== null}
                  onClick={() => onSubscribe(plan.key)}
                  className="mt-5 text-sm bg-accent text-white rounded px-4 py-2 disabled:opacity-50"
                >
                  {pending === plan.key
                    ? "Updating..."
                    : isCurrent
                      ? "Current plan"
                      : "Choose plan"}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
