"use client";

// Client-side fetch helpers for the account center pages. Attaches the active org
// id (persisted by the console/session under `pt_active_org`) as the x-org-id
// header so withOrg scopes each call to the shown org, and unwraps the standard
// { success, data, error, meta } envelope into a small FetchResult shape so pages
// don't each re-implement error handling.

import type { ApiResponse } from "@/lib/api/response";
import type {
  AccountPreferences,
  AccountProfile,
  MfaSummary,
  PersonalToken,
  UserSession,
} from "@/lib/account/types";
import type {
  CreateTokenInput,
  UpdatePasswordInput,
  UpdatePreferencesInput,
  UpdateProfileInput,
} from "@/lib/account/schemas";

const ORG_STORAGE_KEY = "pt_active_org";

function orgHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...(extra ?? {}) };
  if (typeof window !== "undefined") {
    const orgId = window.localStorage.getItem(ORG_STORAGE_KEY);
    if (orgId) headers["x-org-id"] = orgId;
  }
  return headers;
}

export interface FetchResult<T> {
  data: T | null;
  error: string | null;
  total: number;
}

async function unwrap<T>(res: Response): Promise<FetchResult<T>> {
  const body = (await res.json().catch(() => null)) as ApiResponse<T> | null;
  if (!body) {
    return { data: null, error: "Unexpected response from server.", total: 0 };
  }
  if (!res.ok || !body.success) {
    return { data: null, error: body.error ?? "Request failed.", total: 0 };
  }
  return { data: body.data ?? null, error: null, total: body.meta?.total ?? 0 };
}

// ---- Profile ----

export async function fetchProfile(): Promise<FetchResult<AccountProfile>> {
  try {
    const res = await fetch("/api/account/profile", {
      headers: orgHeaders(),
      cache: "no-store",
    });
    return unwrap<AccountProfile>(res);
  } catch {
    return { data: null, error: "Network error loading your profile.", total: 0 };
  }
}

export async function saveProfile(
  input: UpdateProfileInput
): Promise<FetchResult<AccountProfile>> {
  try {
    const res = await fetch("/api/account/profile", {
      method: "PATCH",
      headers: orgHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(input),
    });
    return unwrap<AccountProfile>(res);
  } catch {
    return { data: null, error: "Network error saving your profile.", total: 0 };
  }
}

// ---- Password ----

export async function changePassword(
  input: UpdatePasswordInput
): Promise<FetchResult<{ changed: boolean }>> {
  try {
    const res = await fetch("/api/account/password", {
      method: "PATCH",
      headers: orgHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(input),
    });
    return unwrap<{ changed: boolean }>(res);
  } catch {
    return { data: null, error: "Network error changing your password.", total: 0 };
  }
}

// ---- Tokens ----

export async function fetchTokens(
  page: number,
  limit: number
): Promise<FetchResult<PersonalToken[]>> {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  try {
    const res = await fetch(`/api/account/tokens?${params.toString()}`, {
      headers: orgHeaders(),
      cache: "no-store",
    });
    return unwrap<PersonalToken[]>(res);
  } catch {
    return { data: null, error: "Network error loading your tokens.", total: 0 };
  }
}

export async function createToken(
  input: CreateTokenInput
): Promise<FetchResult<PersonalToken>> {
  try {
    const res = await fetch("/api/account/tokens", {
      method: "POST",
      headers: orgHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(input),
    });
    return unwrap<PersonalToken>(res);
  } catch {
    return { data: null, error: "Network error creating the token.", total: 0 };
  }
}

export async function revokeToken(
  id: string
): Promise<FetchResult<{ revoked: boolean }>> {
  try {
    const res = await fetch(`/api/account/tokens/${id}`, {
      method: "DELETE",
      headers: orgHeaders(),
    });
    return unwrap<{ revoked: boolean }>(res);
  } catch {
    return { data: null, error: "Network error revoking the token.", total: 0 };
  }
}

// ---- Sessions ----

export async function fetchSessions(
  page: number,
  limit: number
): Promise<FetchResult<UserSession[]>> {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  try {
    const res = await fetch(`/api/account/sessions?${params.toString()}`, {
      headers: orgHeaders(),
      cache: "no-store",
    });
    return unwrap<UserSession[]>(res);
  } catch {
    return { data: null, error: "Network error loading your sessions.", total: 0 };
  }
}

export async function revokeSession(
  id: string
): Promise<FetchResult<{ revoked: boolean }>> {
  try {
    const res = await fetch(`/api/account/sessions/${id}`, {
      method: "DELETE",
      headers: orgHeaders(),
    });
    return unwrap<{ revoked: boolean }>(res);
  } catch {
    return { data: null, error: "Network error revoking the session.", total: 0 };
  }
}

// ---- Preferences ----

export async function fetchPreferences(): Promise<FetchResult<AccountPreferences>> {
  try {
    const res = await fetch("/api/account/preferences", {
      headers: orgHeaders(),
      cache: "no-store",
    });
    return unwrap<AccountPreferences>(res);
  } catch {
    return { data: null, error: "Network error loading your preferences.", total: 0 };
  }
}

export async function savePreferences(
  input: UpdatePreferencesInput
): Promise<FetchResult<AccountPreferences>> {
  try {
    const res = await fetch("/api/account/preferences", {
      method: "PATCH",
      headers: orgHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(input),
    });
    return unwrap<AccountPreferences>(res);
  } catch {
    return { data: null, error: "Network error saving your preferences.", total: 0 };
  }
}

// ---- MFA summary (read-only; reuses the shared /api/mfa/factors endpoint) ----

interface MfaFactorLike {
  type: string;
  verified: boolean;
}

// Derives an MfaSummary from the existing MFA factors endpoint so the account
// security page can show posture without owning MFA data itself.
export async function fetchMfaSummary(): Promise<FetchResult<MfaSummary>> {
  try {
    const res = await fetch("/api/mfa/factors", {
      headers: orgHeaders(),
      cache: "no-store",
    });
    const result = await unwrap<MfaFactorLike[]>(res);
    if (result.error) {
      return { data: null, error: result.error, total: 0 };
    }
    const factors = (result.data ?? []).filter((f) => f.verified);
    const types = Array.from(new Set(factors.map((f) => f.type)));
    return {
      data: { enabled: factors.length > 0, factorCount: factors.length, types },
      error: null,
      total: 0,
    };
  } catch {
    return { data: null, error: "Network error loading MFA status.", total: 0 };
  }
}
