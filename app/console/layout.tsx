"use client";

import { useEffect, useState, useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";

interface SessionOrg {
  id: string;
  name: string;
  slug: string;
  role: string;
}

interface SessionUser {
  id: string;
  email: string;
  name: string | null;
}

const NAV_SECTIONS: { title: string; links: { href: string; label: string }[] }[] = [
  {
    title: "Home",
    links: [
      { href: "/console", label: "Overview" },
      { href: "/console/projects", label: "Projects" },
      { href: "/console/search", label: "Search" },
    ],
  },
  {
    title: "AI Research",
    links: [
      { href: "/console/copilot", label: "Research Copilot" },
      { href: "/console/ask", label: "Ask the Papers" },
      { href: "/console/deep-research", label: "Deep Research" },
      { href: "/console/query-expansion", label: "Query Expansion" },
      { href: "/console/data-chat", label: "Data Chat" },
      { href: "/console/guideline-audit", label: "Guideline Audit" },
      { href: "/console/draft", label: "Draft Assistant" },
      { href: "/console/science", label: "Claude Science" },
    ],
  },
  {
    title: "Bench & clinic",
    links: [
      { href: "/console/lab-notebook", label: "Lab Notebook" },
      { href: "/console/trial-matcher", label: "Trial Matcher" },
      { href: "/console/bio/finding", label: "Finding Verifier" },
      { href: "/console/ontology", label: "Ontology" },
    ],
  },
  {
    title: "Evidence synthesis",
    links: [
      { href: "/console/verify", label: "Verify a claim" },
      { href: "/console/workbench", label: "Evidence Workbench" },
      { href: "/console/evidence-report", label: "Evidence Report" },
      { href: "/console/synthesis", label: "Meta-analysis" },
      { href: "/console/meta-advanced", label: "Bayesian / Sensitivity" },
      { href: "/console/fragility", label: "Verdict Fragility" },
      { href: "/console/living-evidence", label: "Living Evidence" },
      { href: "/console/synthesis-report", label: "Synthesis Report" },
      { href: "/console/extraction", label: "Paper Extraction" },
      { href: "/console/citations", label: "Smart Citations" },
      { href: "/console/graph", label: "Knowledge Graph" },
      { href: "/console/hypotheses", label: "Research Gaps" },
      { href: "/console/contradiction", label: "Contradiction Atlas" },
      { href: "/console/mechanism-context", label: "Mechanism Context" },
    ],
  },
  {
    title: "Systematic review",
    links: [
      { href: "/console/prisma", label: "PRISMA Autopilot" },
      { href: "/console/screening", label: "Screening" },
      { href: "/console/reviews", label: "Reviews" },
      { href: "/console/publications", label: "Publications" },
      { href: "/console/alerts", label: "Evidence Alerts" },
      { href: "/console/monitoring", label: "Monitoring" },
      { href: "/console/signals", label: "Signals" },
    ],
  },
  {
    title: "Library",
    links: [
      { href: "/console/claims", label: "Claims" },
      { href: "/console/documents", label: "Documents" },
      { href: "/console/sources/ingest", label: "Source Ingest" },
      { href: "/console/evidence", label: "Evidence" },
      { href: "/console/evidence-reports", label: "Saved Reports" },
      { href: "/console/references", label: "References" },
    ],
  },
  {
    title: "Report & analyze",
    links: [
      { href: "/console/reports", label: "Reports" },
      { href: "/console/submission", label: "Submission Bundle" },
      { href: "/console/analytics", label: "Analytics" },
      { href: "/console/analytics/evidence-reports", label: "Evidence Analytics" },
      { href: "/console/evaluation", label: "Evaluation" },
      { href: "/console/workflows", label: "Workflows" },
      { href: "/console/activity", label: "Activity" },
    ],
  },
  {
    title: "Platform",
    links: [
      { href: "/console/team", label: "Team" },
      { href: "/console/billing", label: "Billing" },
      { href: "/console/developers", label: "Developers" },
      { href: "/console/integrations", label: "Integrations" },
      { href: "/console/tools", label: "Tools" },
      { href: "/console/notifications", label: "Notifications" },
      { href: "/console/jobs", label: "Jobs" },
      { href: "/console/schedules", label: "Schedules" },
    ],
  },
  {
    title: "Governance",
    links: [
      { href: "/console/compliance", label: "Compliance" },
      { href: "/console/compliance/controls", label: "Controls" },
      { href: "/console/governance/data", label: "Data Governance" },
      { href: "/console/enterprise/audit-export", label: "Audit Export" },
      { href: "/console/admin/security", label: "Security (XDR)" },
      { href: "/console/billing/tier", label: "Plan & Tiers" },
      { href: "/console/audit", label: "Audit" },
      { href: "/console/audit/custody", label: "Chain of Custody" },
      { href: "/console/settings", label: "Settings" },
      { href: "/console/admin", label: "Admin" },
    ],
  },
];

const ORG_STORAGE_KEY = "pt_active_org";

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [orgs, setOrgs] = useState<SessionOrg[]>([]);
  const [activeOrgId, setActiveOrgId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/auth/session");
        if (res.status === 401) {
          router.replace("/login");
          return;
        }
        const body = await res.json().catch(() => null);
        if (!res.ok || !body?.success) {
          router.replace("/login");
          return;
        }
        if (cancelled) return;
        setUser(body.data.user);
        setOrgs(body.data.orgs);
        const stored =
          typeof window !== "undefined"
            ? window.localStorage.getItem(ORG_STORAGE_KEY)
            : null;
        const match = body.data.orgs.find((o: SessionOrg) => o.id === stored);
        setActiveOrgId(match?.id ?? body.data.orgs[0]?.id ?? null);
      } catch {
        router.replace("/login");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  const onSwitchOrg = useCallback((orgId: string) => {
    setActiveOrgId(orgId);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(ORG_STORAGE_KEY, orgId);
    }
    router.refresh();
  }, [router]);

  const onLogout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    router.replace("/login");
  }, [router]);

  if (loading) {
    return (
      <div className="min-h-screen bg-paper flex items-center justify-center">
        <p className="text-sm text-ink/40">Loading workspace...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-paper flex">
      <aside className="w-56 shrink-0 border-r border-ink/15 bg-white flex flex-col">
        <div className="h-14 flex items-center px-4 border-b border-ink/15">
          <Link href="/console" className="flex items-center gap-2 font-semibold text-ink/80">
            <Image src="/logo.png" alt="PaperTrail" width={30} height={20} className="h-6 w-auto" />
            PaperTrail
          </Link>
        </div>
        <nav className="flex-1 overflow-y-auto py-2">
          {NAV_SECTIONS.map((section) => (
            <div key={section.title} className="mb-1">
              <div className="px-4 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wide text-ink/30">
                {section.title}
              </div>
              {section.links.map((link) => {
                const active =
                  link.href === "/console"
                    ? pathname === "/console"
                    : pathname.startsWith(link.href);
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={`block px-4 py-1.5 text-sm ${
                      active ? "text-accent font-medium" : "text-ink/70 hover:text-ink/80"
                    }`}
                  >
                    {link.label}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 shrink-0 border-b border-ink/15 bg-white flex items-center justify-between px-4">
          <div>
            {orgs.length > 0 ? (
              <select
                value={activeOrgId ?? ""}
                onChange={(e) => onSwitchOrg(e.target.value)}
                className="text-sm text-ink/80 border border-ink/15 rounded px-2 py-1 focus:outline-none focus:border-accent"
                aria-label="Switch organization"
              >
                {orgs.map((org) => (
                  <option key={org.id} value={org.id}>
                    {org.name}
                  </option>
                ))}
              </select>
            ) : null}
          </div>
          <div className="relative">
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="text-sm text-ink/70 hover:text-ink/80"
            >
              {user?.name ?? user?.email ?? "Account"}
            </button>
            {menuOpen ? (
              <div className="absolute right-0 mt-2 w-44 bg-white border border-ink/15 rounded shadow-sm py-1 z-10">
                <div className="px-3 py-2 text-xs text-ink/35 border-b border-ink/15">
                  {user?.email}
                </div>
                <Link
                  href="/console/settings"
                  className="block px-3 py-2 text-sm text-ink/70 hover:text-ink/80"
                  onClick={() => setMenuOpen(false)}
                >
                  Settings
                </Link>
                <button
                  onClick={onLogout}
                  className="block w-full text-left px-3 py-2 text-sm text-accent"
                >
                  Sign out
                </button>
              </div>
            ) : null}
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
