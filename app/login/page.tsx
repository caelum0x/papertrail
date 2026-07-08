"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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
        <form onSubmit={onSubmit} className="mt-6 space-y-4">
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
