"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { MfaSummary as MfaSummaryData } from "@/lib/account/types";
import { Card } from "@/components/account/Card";
import { LoadingRows, ErrorState } from "@/components/account/states";
import { fetchMfaSummary } from "../../_components/api";

// Read-only summary of the user's two-factor posture. The account center doesn't
// own MFA enrollment — it links out to the dedicated MFA flow — so this just
// reflects the current factor count derived from /api/mfa/factors.
export function MfaSummary() {
  const [data, setData] = useState<MfaSummaryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      const res = await fetchMfaSummary();
      if (cancelled) return;
      if (res.error || !res.data) {
        setError(res.error ?? "Couldn't load MFA status.");
      } else {
        setData(res.data);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Card
      title="Two-factor authentication"
      description="Add a second factor to protect your account at sign-in."
    >
      {loading ? (
        <LoadingRows rows={1} />
      ) : error || !data ? (
        <ErrorState message={error ?? "Couldn't load MFA status."} />
      ) : (
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-ink/80">
              {data.enabled ? "Two-factor is on" : "Two-factor is off"}
            </p>
            <p className="mt-0.5 text-xs text-ink/50">
              {data.enabled
                ? `${data.factorCount} verified factor${data.factorCount === 1 ? "" : "s"}${
                    data.types.length ? ` · ${data.types.join(", ")}` : ""
                  }`
                : "Your account is protected by password only."}
            </p>
          </div>
          <Link
            href="/console/settings"
            className="rounded-md border border-ink/15 bg-white px-3 py-1.5 text-sm font-medium text-ink/70 hover:bg-ink/5"
          >
            {data.enabled ? "Manage" : "Set up"}
          </Link>
        </div>
      )}
    </Card>
  );
}
