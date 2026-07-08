"use client";

// Client-side fetch helpers for the onboarding console pages. Attaches the active
// org id (persisted by the console layout) as the x-org-id header so withOrg scopes
// API calls to the org shown in the switcher, and unwraps the standard
// { success, data, error, meta } envelope into a small FetchResult shape.

import type { ApiResponse } from "@/lib/api/response";
import type {
  Checklist,
  OnboardingState,
  SeededSample,
  StepId,
} from "./types";

const ORG_STORAGE_KEY = "pt_active_org";

function orgHeaders(json = false): Record<string, string> {
  const headers: Record<string, string> = {};
  if (json) headers["Content-Type"] = "application/json";
  if (typeof window !== "undefined") {
    const orgId = window.localStorage.getItem(ORG_STORAGE_KEY);
    if (orgId) headers["x-org-id"] = orgId;
  }
  return headers;
}

export interface FetchResult<T> {
  data: T | null;
  error: string | null;
}

async function unwrap<T>(res: Response): Promise<FetchResult<T>> {
  const body = (await res.json().catch(() => null)) as ApiResponse<T> | null;
  if (!body) {
    return { data: null, error: "Unexpected response from server." };
  }
  if (!res.ok || !body.success) {
    return { data: null, error: body.error ?? "Request failed." };
  }
  return { data: body.data ?? null, error: null };
}

export async function fetchState(): Promise<FetchResult<OnboardingState>> {
  try {
    const res = await fetch("/api/onboarding/state", {
      headers: orgHeaders(),
      cache: "no-store",
    });
    return unwrap<OnboardingState>(res);
  } catch {
    return { data: null, error: "Network error loading your progress." };
  }
}

export async function fetchChecklist(): Promise<FetchResult<Checklist>> {
  try {
    const res = await fetch("/api/onboarding/checklist", {
      headers: orgHeaders(),
      cache: "no-store",
    });
    return unwrap<Checklist>(res);
  } catch {
    return { data: null, error: "Network error loading your checklist." };
  }
}

export async function completeStep(
  step: StepId
): Promise<FetchResult<OnboardingState>> {
  try {
    const res = await fetch("/api/onboarding/complete-step", {
      method: "POST",
      headers: orgHeaders(true),
      body: JSON.stringify({ step }),
    });
    return unwrap<OnboardingState>(res);
  } catch {
    return { data: null, error: "Network error saving your progress." };
  }
}

export async function seedSample(): Promise<FetchResult<SeededSample>> {
  try {
    const res = await fetch("/api/onboarding/seed-sample", {
      method: "POST",
      headers: orgHeaders(true),
    });
    return unwrap<SeededSample>(res);
  } catch {
    return { data: null, error: "Network error loading sample data." };
  }
}
