import Link from "next/link";

// GitHub link is a placeholder — replace href="#" with the real repo URL once public.
const GITHUB_URL = "#";

export function Footer() {
  return (
    <footer className="mt-16 border-t border-ink/10 bg-white">
      <div className="mx-auto flex max-w-5xl flex-col gap-3 px-4 py-8 text-sm text-ink/60">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span>
            PaperTrail — open-source (MIT), built for Built with Claude: Life
            Sciences
          </span>
          <nav className="flex items-center gap-4">
            <Link href="/about" className="hover:text-ink">
              About
            </Link>
            <Link href="/api-docs" className="hover:text-ink">
              API
            </Link>
            <a
              href={GITHUB_URL}
              className="hover:text-ink"
              target="_blank"
              rel="noopener noreferrer"
            >
              GitHub
            </a>
          </nav>
        </div>
        <p className="text-ink/40">
          Unrelated to any other project named PaperTrail.
        </p>
      </div>
    </footer>
  );
}
