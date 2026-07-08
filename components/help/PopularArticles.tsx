"use client";

// The main article list on the help center landing page. Renders loading, error,
// and empty states, then a list of ArticleCard rows. "Popular" here means the
// org's most recent articles (or search/category-filtered results).
import type { HelpArticleDto } from "@/app/console/help/api";
import { ArticleCard } from "./ArticleCard";
import { EmptyState } from "./EmptyState";

export function PopularArticles({
  articles,
  loading,
  error,
  heading,
  onRetry,
}: {
  articles: HelpArticleDto[];
  loading: boolean;
  error: string | null;
  heading: string;
  onRetry: () => void;
}) {
  return (
    <section>
      <h2 className="text-sm font-medium text-ink/60 mb-3">{heading}</h2>
      {loading ? (
        <p className="text-sm text-ink/40">Loading articles...</p>
      ) : error ? (
        <div className="bg-white border border-ink/10 rounded-lg p-5">
          <p className="text-sm text-red-600">{error}</p>
          <button onClick={onRetry} className="mt-2 text-sm text-accent">
            Retry
          </button>
        </div>
      ) : articles.length === 0 ? (
        <EmptyState
          title="No articles found."
          hint="Try a different search term or category."
        />
      ) : (
        <ul className="space-y-2">
          {articles.map((a) => (
            <li key={a.id}>
              <ArticleCard article={a} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
