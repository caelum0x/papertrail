import type { Metadata } from "next";
import Link from "next/link";
import { ENDPOINTS } from "../_components/apiEndpoints";
import {
  EndpointCard,
  EndpointIndex,
} from "../_components/apiReference";

export const metadata: Metadata = {
  title: "API reference — Developers — PaperTrail",
  description:
    "Interactive reference for the PaperTrail public API: authenticate with an API key and verify clinical-trial claims programmatically.",
};

// Interactive API reference for the developer portal. Endpoint definitions live
// in _components/apiEndpoints.ts (generated from lib/apiSpec.ts + the public
// entries); the presentational pieces live in _components/apiReference.tsx.
export default function DeveloperApiReferencePage() {
  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold text-ink/80">API reference</h1>
        <Link
          href="/console/developers"
          className="text-sm text-ink/60 hover:text-accent"
        >
          ← Developers
        </Link>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-ink/70">
        The public API is authenticated with an{" "}
        <Link href="/console/developers" className="text-accent hover:underline">
          API key
        </Link>{" "}
        in the{" "}
        <code className="rounded bg-paper px-1 py-0.5 font-mono text-xs">
          x-api-key
        </code>{" "}
        header. All responses use the standard{" "}
        <code className="rounded bg-paper px-1 py-0.5 font-mono text-xs">
          {"{ success, data, error }"}
        </code>{" "}
        envelope. Console webhook-management routes use your session and require
        an admin or owner role.
      </p>

      <section className="mt-8">
        <h2 className="text-sm font-medium uppercase tracking-wide text-ink/40">
          Endpoints
        </h2>
        <EndpointIndex endpoints={ENDPOINTS} />
      </section>

      <div className="mt-6">
        {ENDPOINTS.map((e) => (
          <EndpointCard key={`${e.method} ${e.path}`} endpoint={e} />
        ))}
      </div>
    </div>
  );
}
