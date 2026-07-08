import { type ApiEndpoint } from "@/lib/apiSpec";
import { CodeBlock } from "./CodeBlock";
import { MethodBadge } from "./MethodBadge";

// The one worked example we keep in full — the core endpoint everyone hits first.
const VERIFY_CURL = `curl -X POST https://your-deployment.vercel.app/api/verify \\
  -H "Content-Type: application/json" \\
  -d '{"claim": "Drug X reduced major cardiac events by 30% in adults with heart failure."}'`;

export function EndpointCard({ endpoint }: { endpoint: ApiEndpoint }) {
  return (
    <section className="border-t border-ink/10 py-8">
      <div className="flex items-center gap-3">
        <MethodBadge method={endpoint.method} />
        <code className="font-mono text-sm text-ink/90">{endpoint.path}</code>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-ink/70">{endpoint.description}</p>
      {endpoint.path === "/api/verify" && <CodeBlock label="Example (curl)">{VERIFY_CURL}</CodeBlock>}
      <CodeBlock label="Request">{endpoint.request}</CodeBlock>
      <CodeBlock label="Response">{endpoint.response}</CodeBlock>
    </section>
  );
}
