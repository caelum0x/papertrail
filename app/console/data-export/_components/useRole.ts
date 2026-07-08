"use client";

import { useEffect, useState } from "react";

// Resolves the current user's role in the active org from the session endpoint so
// data-export pages can gate mutating actions (start export) to editor+.
// Self-contained to keep the module decoupled from siblings.

const ORG_STORAGE_KEY = "pt_active_org";
const RANK: Record<string, number> = { owner: 4, admin: 3, editor: 2, viewer: 1 };

interface SessionOrg {
  id: string;
  role: string;
}

export interface RoleState {
  role: string | null;
  loading: boolean;
  // Can the user start exports (editor and above).
  canEdit: boolean;
}

export function useRole(): RoleState {
  const [role, setRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/auth/session");
        const body = await res.json().catch(() => null);
        if (cancelled || !body?.success) return;
        const orgs: SessionOrg[] = body.data?.orgs ?? [];
        const stored =
          typeof window !== "undefined"
            ? window.localStorage.getItem(ORG_STORAGE_KEY)
            : null;
        const active = orgs.find((o) => o.id === stored) ?? orgs[0];
        setRole(active?.role ?? null);
      } catch {
        if (!cancelled) setRole(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const canEdit = role ? (RANK[role] ?? 0) >= RANK.editor : false;
  return { role, loading, canEdit };
}
