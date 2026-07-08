"use client";

import { useEffect, useState } from "react";

const ORG_STORAGE_KEY = "pt_active_org";

// Resolves the caller's role in the active org from the session endpoint,
// matched against the org id persisted by the console layout's switcher.
// Returns null while loading or if the lookup fails (controls stay hidden).
export function useActiveOrgRole(): string | null {
  const [role, setRole] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/auth/session", { cache: "no-store" });
        const body = await res.json().catch(() => null);
        if (cancelled || !body?.success) return;
        const stored =
          typeof window !== "undefined"
            ? window.localStorage.getItem(ORG_STORAGE_KEY)
            : null;
        const orgs: { id: string; role: string }[] = body.data.orgs ?? [];
        const match = orgs.find((o) => o.id === stored) ?? orgs[0];
        setRole(match?.role ?? null);
      } catch {
        // Leave role null; decision controls stay hidden.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return role;
}

// Roles that may approve/reject (editors submit, admins approve).
export const APPROVER_ROLES = new Set(["owner", "admin"]);
