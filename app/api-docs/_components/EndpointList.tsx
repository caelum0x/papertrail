import { API_SPEC } from "@/lib/apiSpec";
import { MethodBadge } from "./MethodBadge";

export function EndpointList() {
  return (
    <section className="mt-10">
      <h2 className="text-sm font-medium uppercase tracking-wide text-ink/40">Endpoints</h2>
      <ul className="mt-3 flex flex-col gap-2">
        {API_SPEC.map((e) => (
          <li
            key={`${e.method} ${e.path}`}
            className="flex items-center gap-3 rounded-lg border border-ink/10 bg-white p-3"
          >
            <MethodBadge method={e.method} />
            <code className="min-w-0 shrink-0 font-mono text-sm text-ink/90">{e.path}</code>
            <span className="min-w-0 flex-1 text-right text-xs text-ink/50">{e.description}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
