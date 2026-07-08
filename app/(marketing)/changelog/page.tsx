import type { Metadata } from "next";
import { ChangelogHeader } from "./_components/ChangelogHeader";
import { ReleaseList } from "./_components/ReleaseList";
import { ChangelogFooter } from "./_components/ChangelogFooter";

export const metadata: Metadata = {
  title: "Changelog — PaperTrail",
  description:
    "What has shipped in PaperTrail: the verification pipeline, provenance guarantees, access control, audit trail, and the public trust center.",
};

export default function ChangelogPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <ChangelogHeader />
      <ReleaseList />
      <ChangelogFooter />
    </main>
  );
}
