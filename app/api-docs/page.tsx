import type { Metadata } from "next";
import { API_SPEC } from "@/lib/apiSpec";
import { ApiDocsIntro } from "./_components/ApiDocsIntro";
import { EndpointList } from "./_components/EndpointList";
import { EndpointCard } from "./_components/EndpointCard";

export const metadata: Metadata = {
  title: "API — PaperTrail",
  description:
    "HTTP API reference for PaperTrail: verify clinical-trial claims and read stored verifications.",
};

export default function ApiDocsPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <ApiDocsIntro />

      <EndpointList />

      <div className="mt-10">
        {API_SPEC.map((e) => (
          <EndpointCard key={`${e.method} ${e.path}`} endpoint={e} />
        ))}
      </div>
    </main>
  );
}
