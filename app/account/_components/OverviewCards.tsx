"use client";

import Link from "next/link";
import type { AccountProfile, MfaSummary } from "@/lib/account/types";

// The three summary cards on the account overview: identity, security posture,
// and tokens. Each links to the relevant sub-page. Presentational — the parent
// fetches and passes the already-loaded data.

function initialsOf(name: string | null, email: string): string {
  const source = (name ?? email).trim();
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

export function IdentityCard({ profile }: { profile: AccountProfile }) {
  const label = profile.displayName || profile.name || profile.email;
  return (
    <Link
      href="/account/profile"
      className="block rounded-lg border border-ink/10 bg-white p-5 hover:border-ink/20"
    >
      <div className="flex items-center gap-3">
        {profile.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={profile.avatarUrl}
            alt=""
            className="h-10 w-10 rounded-full object-cover"
          />
        ) : (
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/10 text-sm font-semibold text-accent">
            {initialsOf(profile.name, profile.email)}
          </span>
        )}
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-ink/80">{label}</p>
          <p className="truncate text-xs text-ink/50">{profile.email}</p>
        </div>
      </div>
      {profile.title ? (
        <p className="mt-3 text-xs text-ink/50">{profile.title}</p>
      ) : null}
      <p className="mt-3 text-xs font-medium text-accent">Edit profile →</p>
    </Link>
  );
}

export function SecurityCard({ mfa }: { mfa: MfaSummary }) {
  return (
    <Link
      href="/account/security"
      className="block rounded-lg border border-ink/10 bg-white p-5 hover:border-ink/20"
    >
      <p className="text-xs font-medium uppercase tracking-wide text-ink/40">
        Security
      </p>
      <p className="mt-2 text-sm font-medium text-ink/80">
        {mfa.enabled
          ? `MFA on · ${mfa.factorCount} factor${mfa.factorCount === 1 ? "" : "s"}`
          : "MFA not enabled"}
      </p>
      <p className="mt-1 text-xs text-ink/50">
        Manage your password, active sessions, and two-factor authentication.
      </p>
      <p className="mt-3 text-xs font-medium text-accent">Review security →</p>
    </Link>
  );
}

export function TokensCard({ tokenCount }: { tokenCount: number }) {
  return (
    <Link
      href="/account/tokens"
      className="block rounded-lg border border-ink/10 bg-white p-5 hover:border-ink/20"
    >
      <p className="text-xs font-medium uppercase tracking-wide text-ink/40">
        Access tokens
      </p>
      <p className="mt-2 text-sm font-medium text-ink/80">
        {tokenCount} active token{tokenCount === 1 ? "" : "s"}
      </p>
      <p className="mt-1 text-xs text-ink/50">
        Personal tokens for CLI and script access to the API.
      </p>
      <p className="mt-3 text-xs font-medium text-accent">Manage tokens →</p>
    </Link>
  );
}
