"use client";

import { useCallback, useEffect, useState } from "react";
import type { AccountProfile, MfaSummary } from "@/lib/account/types";
import { AccountShell } from "@/components/account/AccountShell";
import { LoadingRows, ErrorState } from "@/components/account/states";
import {
  fetchProfile,
  fetchMfaSummary,
  fetchTokens,
} from "./api";
import { IdentityCard, SecurityCard, TokensCard } from "./OverviewCards";

// Account overview: composes the identity / security / tokens summary cards from
// three parallel fetches. Renders a single loading and error surface for the page
// rather than three independent spinners.
export function AccountOverview() {
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [mfa, setMfa] = useState<MfaSummary | null>(null);
  const [tokenCount, setTokenCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [profileRes, mfaRes, tokensRes] = await Promise.all([
      fetchProfile(),
      fetchMfaSummary(),
      fetchTokens(1, 1),
    ]);
    if (profileRes.error || !profileRes.data) {
      setError(profileRes.error ?? "Couldn't load your account.");
      setLoading(false);
      return;
    }
    setProfile(profileRes.data);
    setMfa(mfaRes.data ?? { enabled: false, factorCount: 0, types: [] });
    setTokenCount(tokensRes.total);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <AccountShell
      title="Your account"
      description="Manage your personal profile, security, access tokens, and preferences. These settings are yours — distinct from your organization's settings."
    >
      {loading ? (
        <LoadingRows rows={3} />
      ) : error || !profile || !mfa ? (
        <ErrorState message={error ?? "Couldn't load your account."} onRetry={load} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <IdentityCard profile={profile} />
          <SecurityCard mfa={mfa} />
          <TokensCard tokenCount={tokenCount} />
        </div>
      )}
    </AccountShell>
  );
}
