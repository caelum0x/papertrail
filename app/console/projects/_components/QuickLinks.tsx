import Link from "next/link";

// Grid of navigation cards linking out to the related console modules.

const CARDS: { href: string; label: string }[] = [
  { href: "/console/claims", label: "Claims" },
  { href: "/console/evidence", label: "Evidence" },
  { href: "/console/reports", label: "Reports" },
];

export function QuickLinks() {
  return (
    <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
      {CARDS.map((card) => (
        <Link
          key={card.href}
          href={card.href}
          className="bg-white border border-ink/15 rounded-lg p-5 hover:border-accent"
        >
          <div className="text-sm font-medium text-ink/70">{card.label}</div>
          <div className="mt-1 text-sm text-ink/40">
            Open {card.label.toLowerCase()}
          </div>
        </Link>
      ))}
    </div>
  );
}
