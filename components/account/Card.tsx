import type { ReactNode } from "react";

interface CardProps {
  title?: string;
  description?: string;
  footer?: ReactNode;
  children: ReactNode;
}

// A plain white panel with an optional titled header and footer, used to group a
// form or list section on an account page. Consistent border / radius / padding
// so every section on every account page reads as the same component family.
export function Card({ title, description, footer, children }: CardProps) {
  return (
    <section className="rounded-lg border border-ink/10 bg-white">
      {title ? (
        <header className="border-b border-ink/10 px-5 py-4">
          <h2 className="text-sm font-semibold text-ink/80">{title}</h2>
          {description ? (
            <p className="mt-0.5 text-xs text-ink/50">{description}</p>
          ) : null}
        </header>
      ) : null}
      <div className="px-5 py-4">{children}</div>
      {footer ? (
        <footer className="border-t border-ink/10 px-5 py-3">{footer}</footer>
      ) : null}
    </section>
  );
}
