import type { ApiEndpoint } from "./apiEndpoints";
import { V1_CURL } from "./apiEndpoints";

interface CodeBlockProps {
  children: string;
  label?: string;
}

export function CodeBlock({ children, label }: CodeBlockProps) {
  return (
    <div className="mt-3">
      {label ? (
        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-ink/40">
          {label}
        </p>
      ) : null}
      <pre className="overflow-x-auto rounded-lg border border-ink/10 bg-ink/5 p-4 text-xs leading-relaxed text-ink/80">
        <code>{children}</code>
      </pre>
    </div>
  );
}

export function MethodBadge({ method }: { method: string }) {
  const classes =
    method === "POST"
      ? "bg-accent/10 text-accent"
      : method === "DELETE"
      ? "bg-red-100 text-red-700"
      : method === "PATCH"
      ? "bg-amber-100 text-amber-700"
      : "bg-ink/10 text-ink/70";
  return (
    <span
      className={`inline-block shrink-0 rounded px-2 py-0.5 font-mono text-xs font-semibold ${classes}`}
    >
      {method}
    </span>
  );
}

// A single expanded endpoint entry: method + path, description, and request /
// response code blocks (plus a curl example for the verify endpoint).
export function EndpointCard({ endpoint }: { endpoint: ApiEndpoint }) {
  return (
    <section className="border-t border-ink/10 py-8">
      <div className="flex items-center gap-3">
        <MethodBadge method={endpoint.method} />
        <code className="font-mono text-sm text-ink/90">{endpoint.path}</code>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-ink/70">
        {endpoint.description}
      </p>
      {endpoint.path === "/api/v1/verify" ? (
        <CodeBlock label="Example (curl)">{V1_CURL}</CodeBlock>
      ) : null}
      <CodeBlock label="Request">{endpoint.request}</CodeBlock>
      <CodeBlock label="Response">{endpoint.response}</CodeBlock>
    </section>
  );
}

// The compact index of endpoints rendered above the detailed cards.
export function EndpointIndex({ endpoints }: { endpoints: ApiEndpoint[] }) {
  return (
    <ul className="mt-3 flex flex-col gap-2">
      {endpoints.map((e) => (
        <li
          key={`${e.method} ${e.path}`}
          className="flex items-center gap-3 rounded-lg border border-ink/10 bg-white p-3"
        >
          <MethodBadge method={e.method} />
          <code className="min-w-0 shrink-0 font-mono text-sm text-ink/90">
            {e.path}
          </code>
          <span className="min-w-0 flex-1 text-right text-xs text-ink/50">
            {e.description}
          </span>
        </li>
      ))}
    </ul>
  );
}
