import type { Metadata } from "next";
import { SecurityHeader } from "./_components/SecurityHeader";
import { PillarList } from "./_components/PillarList";
import { DataHandlingSection } from "./_components/DataHandlingSection";
import { VerifySection } from "./_components/VerifySection";

export const metadata: Metadata = {
  title: "Security & trust center — PaperTrail",
  description:
    "How PaperTrail earns trust: deterministic verification, code-enforced provenance, role-based access control, and a tamper-evident audit trail.",
};

export default function SecurityPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <SecurityHeader />
      <PillarList />
      <DataHandlingSection />
      <VerifySection />
    </main>
  );
}
