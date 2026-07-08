"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

// Reusable console-wide nudge that surfaces onboarding progress and links to the
// setup wizard when setup isn't finished. Self-contained: it fetches the caller's
// checklist directly (org-scoped via x-org-id) and renders nothing once complete
// or on any error, so it's safe to drop into any console page/layout.

const ORG_STORAGE_KEY = "pt_active_org";

interface ChecklistEnvelope {
  success: boolean;
  data: {
    completed: boolean;
    required_done: number;
    required_total: number;
    percent: number;
  } | null;
  error: string | null;
}

function orgHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  if (typeof window !== "undefined") {
    const orgId = window.localStorage.getItem(ORG_STORAGE_KEY);
    if (orgId) headers["x-org-id"] = orgId;
  }
  return headers;
}

export function OnboardingBanner() {
  const [percent, setPercent] = useState<number | null>(null);
  const [done, setDone] = useState<{ n: number; total: number } | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/onboarding/checklist", {
          headers: orgHeaders(),
          cache: "no-store",
        });
        const body = (await res.json().catch(() => null)) as
          | ChecklistEnvelope
          | null;
        if (cancelled || !body?.success || !body.data) return;
        if (body.data.completed) return; // Nothing to nudge.
        setPercent(body.data.percent);
        setDone({ n: body.data.required_done, total: body.data.required_total });
      } catch {
        // Best-effort nudge — stay silent on failure.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (hidden || percent === null || done === null) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-accent/20 bg-accent/5 px-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink/80">
          Finish setting up your workspace
        </p>
        <p className="mt-0.5 text-xs text-ink/60">
          {done.n} of {done.total} steps done · {percent}% complete
        </p>
      </div>
      <div className="flex items-center gap-3">
        <Link
          href="/console/onboarding"
          className="rounded bg-accent px-3 py-1.5 text-sm text-white"
        >
          Continue setup
        </Link>
        <button
          type="button"
          onClick={() => setHidden(true)}
          className="text-sm text-ink/60 hover:text-ink/80"
          aria-label="Dismiss onboarding reminder"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
