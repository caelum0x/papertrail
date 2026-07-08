"use client";

import { useEffect, useState } from "react";

// Resolves the current user and their active org (+ role) from the session
// endpoint so the wizard can show the workspace name and gate the invite step to
// admins. Self-contained to keep the onboarding module decoupled.

const ORG_STORAGE_KEY = "pt_active_org";
const RANK: Record<string, number> = { owner: 4, admin: 3, editor: 2, viewer: 1 };

export interface SessionOrg {
  id: string;
  name: string;
  slug: string;
  role: string;
}

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
}

export interface SessionState {
  user: SessionUser | null;
  activeOrg: SessionOrg | null;
  role: string | null;
  loading: boolean;
  error: string | null;
  canInvite: boolean;
  canEdit: boolean;
}

export function useSession(): SessionState {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [activeOrg, setActiveOrg] = useState<SessionOrg | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/auth/session", { cache: "no-store" });
        const body = await res.json().catch(() => null);
        if (cancelled) return;
        if (!body?.success || !body.data) {
          setError(body?.error ?? "Failed to load your account.");
          return;
        }
        const orgs: SessionOrg[] = body.data.orgs ?? [];
        const stored =
          typeof window !== "undefined"
            ? window.localStorage.getItem(ORG_STORAGE_KEY)
            : null;
        const active = orgs.find((o) => o.id === stored) ?? orgs[0] ?? null;
        setUser(body.data.user ?? null);
        setActiveOrg(active);
      } catch {
        if (!cancelled) setError("Failed to load your account.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const role = activeOrg?.role ?? null;
  const rank = role ? RANK[role] ?? 0 : 0;
  return {
    user,
    activeOrg,
    role,
    loading,
    error,
    canInvite: rank >= RANK.admin,
    canEdit: rank >= RANK.editor,
  };
}
