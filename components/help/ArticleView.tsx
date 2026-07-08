"use client";

// Renders a single help article's detail. Body is plain text (whitespace
// preserved). Presentational: the parent page handles fetch/loading/error.
import Link from "next/link";
import type { HelpArticleDto } from "@/app/console/help/api";

export function ArticleView({ article }: { article: HelpArticleDto }) {
  return (
    <article className="bg-white border border-ink/10 rounded-lg p-6">
      <div className="flex items-center gap-2">
        <Link
          href={`/console/help?category=${encodeURIComponent(article.category)}`}
          className="text-xs rounded px-2 py-0.5 bg-accent/10 text-accent capitalize hover:opacity-90"
        >
          {article.category}
        </Link>
        <span className="text-xs text-ink/40">
          Updated {new Date(article.createdAt).toLocaleDateString()}
        </span>
      </div>
      <h1 className="mt-3 text-2xl font-semibold text-ink/80">{article.title}</h1>
      <div className="mt-4 text-sm leading-relaxed text-ink/70 whitespace-pre-wrap">
        {article.body}
      </div>
    </article>
  );
}
