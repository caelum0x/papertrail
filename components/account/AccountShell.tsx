import type { ReactNode } from "react";

interface AccountShellProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}

// Shared page scaffold for every account center page: a titled header (with an
// optional actions slot) sitting above the page body. Keeps the header markup and
// spacing identical across profile / security / tokens / preferences pages.
export function AccountShell({
  title,
  description,
  actions,
  children,
}: AccountShellProps) {
  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 border-b border-ink/10 pb-4">
        <div>
          <h1 className="text-2xl font-semibold text-ink/80">{title}</h1>
          {description ? (
            <p className="mt-1 max-w-2xl text-sm text-ink/50">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>
      {children}
    </div>
  );
}
