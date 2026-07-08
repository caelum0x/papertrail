import Link from "next/link";

interface MemberTabsProps {
  memberId: string;
  active: "overview" | "activity";
}

// Sub-navigation for a member detail view: overview vs. activity.
export function MemberTabs({ memberId, active }: MemberTabsProps) {
  const tabs: { key: MemberTabsProps["active"]; label: string; href: string }[] =
    [
      { key: "overview", label: "Overview", href: `/console/team/${memberId}` },
      {
        key: "activity",
        label: "Activity",
        href: `/console/team/${memberId}/activity`,
      },
    ];

  return (
    <nav className="mt-4 flex gap-4 border-b border-ink/10">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          className={
            tab.key === active
              ? "pb-2 -mb-px border-b-2 border-accent text-sm text-ink/80"
              : "pb-2 text-sm text-ink/40 hover:text-ink/60"
          }
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
