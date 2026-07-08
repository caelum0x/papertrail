"use client";

// A single article row/card linking to its detail view. Shows title, category
// pill, and a short excerpt of the body. Used by PopularArticles and search
// results.
import Link from "next/link";
import type { HelpArticleDto } from "@/app/console/help/api";

function excerpt(body: string, max = 140): string {
  const clean = body.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

export function ArticleCard({ article }: { article: HelpArticleDto }) {
  return (
    <Link
      href={`/console/help/articles/${article.slug}`}
      className="block bg-white border border-ink/10 rounded-lg p-4 hover:border-accent"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium text-ink/80">{article.title}</span>
        <span className="shrink-0 text-xs rounded px-2 py-0.5 bg-accent/10 text-accent capitalize">
          {article.category}
        </span>
      </div>
      <p className="mt-1 text-sm text-ink/60">{excerpt(article.body)}</p>
    </Link>
  );
}
