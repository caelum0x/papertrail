"use client";

// Help article detail page. Fetches one article by slug and renders it via
// ArticleView, with loading / error / not-found states.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { apiGet, type HelpArticleDto } from "../../api";
import { ArticleView } from "@/components/help/ArticleView";
import { EmptyState } from "@/components/help/EmptyState";

export default function HelpArticlePage() {
  const params = useParams<{ slug: string }>();
  const slug = params?.slug;

  const [article, setArticle] = useState<HelpArticleDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!slug) return;
    setLoading(true);
    setError(null);
    const res = await apiGet<HelpArticleDto>(
      `/api/help/articles/${encodeURIComponent(slug)}`
    );
    if (!res.success || !res.data) {
      setError(res.error ?? "Failed to load article.");
      setArticle(null);
      setLoading(false);
      return;
    }
    setArticle(res.data);
    setLoading(false);
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div>
      <Link href="/console/help" className="text-sm text-accent">
        ← Back to help center
      </Link>

      <div className="mt-4">
        {loading ? (
          <p className="text-sm text-ink/40">Loading article...</p>
        ) : error ? (
          <EmptyState
            title={error}
            action={
              <button onClick={() => void load()} className="text-sm text-accent">
                Retry
              </button>
            }
          />
        ) : article ? (
          <ArticleView article={article} />
        ) : (
          <EmptyState title="Article not found." />
        )}
      </div>
    </div>
  );
}
