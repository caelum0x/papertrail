import type { ReactNode } from "react";

/** A titled content section — the shared shell for every About-page block. */
export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-10">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** A standard prose paragraph stack used inside sections. */
export function Prose({ children }: { children: ReactNode }) {
  return <div className="space-y-4 text-sm leading-relaxed text-ink/80">{children}</div>;
}
