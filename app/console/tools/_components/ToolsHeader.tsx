import Link from "next/link";

interface ToolsHeaderProps {
  title: string;
  // Description content (may contain inline links), rendered under the title.
  subtitle: React.ReactNode;
  action?: { href: string; label: string };
}

// Header row for the tools module: title + rich description on the left, an
// optional right-aligned bordered link (e.g. "Call history" / "Overview").
export function ToolsHeader({ title, subtitle, action }: ToolsHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold text-ink/80">{title}</h1>
        <p className="mt-1 text-sm text-ink/40">{subtitle}</p>
      </div>
      {action ? (
        <Link
          href={action.href}
          className="shrink-0 text-xs border border-ink/15 rounded px-3 py-1.5 hover:border-accent"
        >
          {action.label}
        </Link>
      ) : null}
    </div>
  );
}
