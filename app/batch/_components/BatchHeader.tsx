import Link from "next/link";

interface BatchHeaderProps {
  maxBatch: number;
}

export function BatchHeader({ maxBatch }: BatchHeaderProps) {
  return (
    <header className="mb-8">
      <h1 className="text-2xl font-semibold">Batch check a passage</h1>
      <p className="mt-1 max-w-2xl text-sm text-ink/60">
        Paste a paragraph — a manuscript Discussion, a grant progress report, a press
        release — and PaperTrail splits it into individual claims and verifies each one
        against its primary source. Up to {maxBatch} claims are checked per run to keep
        it fast and inexpensive.
      </p>
      <Link href="/" className="mt-2 inline-block text-xs text-accent hover:underline">
        ← Single claim
      </Link>
    </header>
  );
}
