import Link from "next/link";

export function PricingFooter() {
  return (
    <p className="mt-8 text-center text-sm text-ink/60">
      Questions about a plan?{" "}
      <Link href="/docs-hub" className="text-accent hover:underline">
        Read the docs
      </Link>{" "}
      or{" "}
      <Link href="/security" className="text-accent hover:underline">
        review our security posture
      </Link>
      .
    </p>
  );
}
