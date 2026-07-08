import Link from "next/link";
import { SearchTypeBadge } from "@/components/search/SearchTypeBadge";
import {
  SEARCH_TYPES,
  SEARCH_TYPE_LABELS,
} from "@/components/search/types";

const TYPE_HINTS: Record<string, string> = {
  claim: "Efficacy statements captured for verification.",
  document: "Source PDFs and papers ingested into the workspace.",
  evidence: "Extracted findings and supporting excerpts.",
  verification: "Comparison results with trust scores and flags.",
};

const TIPS: { title: string; body: string }[] = [
  {
    title: "Search runs across everything",
    body: "One query matches claims, documents, evidence, and verifications at once. Use the type filter to narrow to a single kind of result.",
  },
  {
    title: "Keep the palette one keystroke away",
    body: "Press ⌘K (Ctrl+K on Windows/Linux) from anywhere in the console to open the quick search palette without leaving the page you're on.",
  },
  {
    title: "Results update as you type",
    body: "Queries are debounced, so pause briefly after typing to see the latest matches. Clear the box to return to the idle state.",
  },
];

// Static search tips sub-page. Documents how workspace search behaves and what
// each result type means. Uses no new API — purely reference material.
export default function SearchTipsPage() {
  return (
    <div className="max-w-2xl">
      <Link
        href="/console/search"
        className="text-sm text-accent hover:underline"
      >
        ← Back to search
      </Link>

      <h1 className="mt-4 text-2xl font-semibold text-ink/80">Search tips</h1>
      <p className="mt-1 text-sm text-ink/40">
        How workspace search works and what each result type represents.
      </p>

      <div className="mt-6 space-y-4">
        {TIPS.map((tip) => (
          <div
            key={tip.title}
            className="bg-white border border-ink/10 rounded-lg p-5"
          >
            <h2 className="text-sm font-medium text-ink/80">{tip.title}</h2>
            <p className="mt-1 text-sm text-ink/60">{tip.body}</p>
          </div>
        ))}
      </div>

      <div className="mt-8 bg-white border border-ink/10 rounded-lg overflow-hidden">
        <div className="px-5 py-3 border-b border-ink/10 text-sm font-medium text-ink/70">
          What you can search
        </div>
        <ul className="divide-y divide-ink/10">
          {SEARCH_TYPES.map((type) => (
            <li key={type} className="px-5 py-3 flex items-start gap-3">
              <SearchTypeBadge type={type} />
              <div className="min-w-0">
                <div className="text-sm text-ink/80">
                  {SEARCH_TYPE_LABELS[type]}
                </div>
                <div className="text-xs text-ink/40">{TYPE_HINTS[type]}</div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
