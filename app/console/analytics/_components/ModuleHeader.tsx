import Link from "next/link";

interface AnalyticsNavProps {
  active?: "overview" | "verifications" | "evidence";
}

// Header + sub-navigation shared across the analytics module pages.
export function AnalyticsHeader({ active = "overview" }: AnalyticsNavProps) {
  const links: { href: string; key: AnalyticsNavProps["active"]; label: string }[] = [
    { href: "/console/analytics/verifications", key: "verifications", label: "Verifications" },
    { href: "/console/analytics/evidence", key: "evidence", label: "Evidence" },
  ];
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold text-ink/80">Analytics</h1>
        <p className="mt-1 text-sm text-ink/40">
          Organization-wide verification KPIs, distortion rates, and evidence
          coverage.
        </p>
      </div>
      <nav className="flex gap-2 text-sm">
        {links.map((l) => (
          <Link
            key={l.key}
            href={l.href}
            className={`rounded-md border border-ink/10 bg-white px-3 py-1.5 hover:bg-paper ${
              active === l.key ? "text-accent" : "text-ink/60"
            }`}
          >
            {l.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
