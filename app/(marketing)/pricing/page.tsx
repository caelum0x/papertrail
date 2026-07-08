import type { Metadata } from "next";
import { PricingHeader } from "./_components/PricingHeader";
import { TierGrid } from "./_components/TierGrid";
import { PricingFooter } from "./_components/PricingFooter";

export const metadata: Metadata = {
  title: "Pricing — PaperTrail",
  description:
    "PaperTrail pricing tiers for individual researchers, labs, and organizations that need role-based access, audit trails, and tenant isolation.",
};

export default function PricingPage() {
  return (
    <main className="mx-auto max-w-4xl px-4 py-12">
      <PricingHeader />
      <TierGrid />
      <PricingFooter />
    </main>
  );
}
