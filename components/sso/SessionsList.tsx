"use client";

import { useEffect, useState } from "react";

// Active sessions panel on the security page. There is no server-side session
// registry in this module's scope, so we surface the current browser session
// honestly (from the existing auth session endpoint) rather than fabricating a
// device list. Handles its own loading / error / empty states.

interface SessionUser {
  email: string;
  name: string | null;
}

export function SessionsList() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/auth/session", {
          headers: { Accept: "application/json" },
        });
        const body = await res.json().catch(() => null);
        if (cancelled) return;
        if (!body?.success || !body.data?.user) {
          setError("Couldn't load your session.");
        } else {
          setUser({
            email: body.data.user.email,
            name: body.data.user.name ?? null,
          });
        }
      } catch {
        if (!cancelled) setError("Couldn't load your session.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="bg-white border border-ink/10 rounded-lg overflow-hidden">
      <div className="px-5 py-3 border-b border-ink/10">
        <h2 className="text-sm font-medium text-ink/70">Active session</h2>
        <p className="text-xs text-ink/40">
          The account currently signed in on this device.
        </p>
      </div>

      {loading ? (
        <p className="p-5 text-sm text-ink/40">Loading session…</p>
      ) : error ? (
        <p className="p-5 text-sm text-red-600">{error}</p>
      ) : user ? (
        <div className="px-5 py-4 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="text-sm text-ink/80 truncate">
              {user.name ?? user.email}
            </div>
            <div className="text-xs text-ink/40 truncate">{user.email}</div>
          </div>
          <span className="text-xs rounded px-2 py-0.5 border text-green-700 border-green-600/30 bg-green-50 shrink-0">
            this device
          </span>
        </div>
      ) : (
        <p className="p-5 text-sm text-ink/40">No active session.</p>
      )}
    </section>
  );
}
