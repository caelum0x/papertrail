import Link from "next/link";
import { DEMO_EXAMPLES } from "@/lib/demoExamples";

interface ExampleClaimsProps {
  loading: boolean;
  onSelect: (claim: string) => void;
}

export function ExampleClaims({ loading, onSelect }: ExampleClaimsProps) {
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      <span className="self-center text-xs text-ink/40">Try:</span>
      {DEMO_EXAMPLES.map((ex) => (
        <button
          key={ex.id}
          onClick={() => onSelect(ex.claim)}
          disabled={loading}
          title={ex.blurb}
          className="rounded-full border border-ink/15 bg-white px-3 py-1 text-xs text-ink/70 hover:bg-ink/5 disabled:opacity-50"
        >
          {ex.label}
        </button>
      ))}
      <Link href="/recent" className="self-center text-xs text-accent hover:underline">
        Recent checks →
      </Link>
    </div>
  );
}
