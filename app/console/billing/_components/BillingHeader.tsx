import Link from "next/link";

interface BillingHeaderProps {
  title: string;
  subtitle: string;
  action?: { href: string; label: string };
}

// Page header for the billing module: title, one-line description, and an
// optional right-aligned link (e.g. "Manage plan" / back links on sub-pages).
export function BillingHeader({ title, subtitle, action }: BillingHeaderProps) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <h1 className="text-2xl font-semibold text-ink/80">{title}</h1>
        <p className="mt-1 text-sm text-ink/40">{subtitle}</p>
      </div>
      {action ? (
        <Link href={action.href} className="text-sm text-accent hover:underline">
          {action.label}
        </Link>
      ) : null}
    </div>
  );
}
