import Link from "next/link";

interface NewViewCardProps {
  href: string;
}

// Dashed call-to-action card that sits at the top of the list, inviting the user
// to build a new saved view. Kept as its own component so the list page stays
// composed of small pieces.
export function NewViewCard({ href }: NewViewCardProps) {
  return (
    <Link
      href={href}
      className="flex items-center justify-between rounded-lg border border-dashed border-ink/20 bg-paper px-5 py-4 hover:border-accent"
    >
      <div>
        <p className="text-sm font-medium text-ink/70">Create a saved view</p>
        <p className="mt-0.5 text-sm text-ink/40">
          Capture a search, filters, and sort you use often.
        </p>
      </div>
      <span className="text-sm text-accent">New view</span>
    </Link>
  );
}
