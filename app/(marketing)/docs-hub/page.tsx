import type { Metadata } from "next";
import { DocsHeader } from "./_components/DocsHeader";
import { DocSectionList } from "./_components/DocSectionList";
import { RecentChangesSection } from "./_components/RecentChangesSection";

export const metadata: Metadata = {
  title: "Documentation — PaperTrail",
  description:
    "Documentation hub for PaperTrail: getting started, verifying claims, reading results, the public trust API, and access control.",
};

export default function DocsHubPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <DocsHeader />
      <DocSectionList />
      <RecentChangesSection />
    </main>
  );
}
