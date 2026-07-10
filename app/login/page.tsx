"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { GoogleSignInButton, oauthErrorMessage } from "../_components/GoogleSignInButton";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Surface an OAuth round-trip error (e.g. ?error=google_failed) without needing
  // useSearchParams (which would force a Suspense boundary at build time).
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("error");
    const message = oauthErrorMessage(code);
    if (message) setError(message);
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.success) {
        setError(body?.error ?? "Login failed.");
        return;
      }
      router.push("/console");
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-paper flex items-center justify-center px-4">
      <div className="w-full max-w-sm bg-white border border-ink/15 rounded-lg p-8">
        <h1 className="text-xl font-semibold text-ink/80">Sign in to PaperTrail</h1>
        <p className="mt-1 text-sm text-ink/40">
          Enterprise provenance verification.
        </p>
        <div className="mt-6">
          <GoogleSignInButton />
        </div>
        <div className="my-5 flex items-center gap-3">
          <span className="h-px flex-1 bg-ink/10" />
          <span className="text-xs text-ink/40">or with email</span>
          <span className="h-px flex-1 bg-ink/10" />
        </div>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-ink/70 mb-1" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded border border-ink/15 px-3 py-2 text-sm text-ink/80 focus:outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="block text-sm text-ink/70 mb-1" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded border border-ink/15 px-3 py-2 text-sm text-ink/80 focus:outline-none focus:border-accent"
            />
          </div>
          {error ? <p className="text-sm text-accent">{error}</p> : null}
          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded bg-accent text-white py-2 text-sm font-medium disabled:opacity-60"
          >
            {submitting ? "Signing in..." : "Sign in"}
          </button>
        </form>
        <p className="mt-4 text-sm text-ink/40">
          No account?{" "}
          <Link href="/register" className="text-accent">
            Create one
          </Link>
        </p>
      </div>
    </main>
  );
}
