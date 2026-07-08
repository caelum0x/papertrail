import Link from "next/link";

// Settings hub. Links out to the individual settings surfaces. Kept as a server
// component (no client data fetching) so it renders instantly; each sub-page owns
// its own loading/empty/error states.

interface SettingsLink {
  href: string;
  title: string;
  description: string;
}

const PERSONAL_LINKS: SettingsLink[] = [
  {
    href: "/console/settings/profile",
    title: "Profile",
    description: "Your display name, title, and avatar for this organization.",
  },
  {
    href: "/console/settings/preferences",
    title: "Preferences",
    description: "Theme, density, default landing view, and email digest.",
  },
];

const ORG_LINKS: SettingsLink[] = [
  {
    href: "/console/settings/roles",
    title: "Roles & permissions",
    description: "Reference for what each role can do in your organization.",
  },
  {
    href: "/console/settings/science",
    title: "Science settings",
    description: "Defaults for extraction, verification, and scoring.",
  },
  {
    href: "/console/settings/tags",
    title: "Tags & taxonomy",
    description: "A shared tag vocabulary you can attach across entities.",
  },
  {
    href: "/console/settings/billing",
    title: "Billing",
    description: "Plan, usage, and invoices.",
  },
];

function LinkCard({ link }: { link: SettingsLink }) {
  return (
    <Link
      href={link.href}
      className="block bg-white border border-ink/10 rounded-lg p-5 hover:border-accent transition-colors"
    >
      <h3 className="text-sm font-medium text-ink/80">{link.title}</h3>
      <p className="mt-1 text-sm text-ink/60">{link.description}</p>
    </Link>
  );
}

export default function SettingsHubPage() {
  return (
    <div className="max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold text-ink/80">Settings</h1>
        <p className="mt-1 text-sm text-ink/60">
          Manage your personal profile, preferences, and organization settings.
        </p>
      </div>

      <section className="mt-8">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-ink/60">
          Personal
        </h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {PERSONAL_LINKS.map((link) => (
            <LinkCard key={link.href} link={link} />
          ))}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-ink/60">
          Organization
        </h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {ORG_LINKS.map((link) => (
            <LinkCard key={link.href} link={link} />
          ))}
        </div>
      </section>
    </div>
  );
}
