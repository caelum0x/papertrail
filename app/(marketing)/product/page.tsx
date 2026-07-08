import type { Metadata } from "next";
import { ProductHeader } from "./_components/ProductHeader";
import { PipelineSection } from "./_components/PipelineSection";
import { AudienceSection } from "./_components/AudienceSection";
import { NarrowScopeSection } from "./_components/NarrowScopeSection";
import { ExploreSection } from "./_components/ExploreSection";

export const metadata: Metadata = {
  title: "Product — PaperTrail",
  description:
    "PaperTrail traces a clinical-trial efficacy claim back to its primary source, extracts the actual finding, and flags discrepancies with a trust score and an exact-span citation trail.",
};

export default function ProductPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <ProductHeader />
      <PipelineSection />
      <AudienceSection />
      <NarrowScopeSection />
      <ExploreSection />
    </main>
  );
}
