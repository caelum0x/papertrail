import Link from "next/link";

// A dashed call-to-action tile that sits in the grid and links to the create
// flow. Rendered alongside real TemplateCards so "new" always has a home.
export function NewTemplateCard() {
  return (
    <Link
      href="/console/templates/new"
      className="flex flex-col items-center justify-center gap-1 border border-dashed border-ink/20 rounded-lg p-4 text-center text-ink/50 hover:border-accent hover:text-accent min-h-[9rem]"
    >
      <span className="text-2xl leading-none">+</span>
      <span className="text-sm font-medium">New template</span>
      <span className="text-xs text-ink/40">
        Claim, report, verification, or document
      </span>
    </Link>
  );
}
