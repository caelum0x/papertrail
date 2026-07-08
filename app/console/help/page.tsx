"use client";

// Help center landing page. Composes the search box, category sidebar, article
// list, and feedback widget. Owns the search/category/pagination state and
// refetches the article list + categories from the API.
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  apiGet,
  type HelpArticleDto,
  type HelpCategoryDto,
} from "./api";
import { ModuleHeader } from "@/components/help/ModuleHeader";
import { HelpSearch } from "@/components/help/HelpSearch";
import { CategoryList } from "@/components/help/CategoryList";
import { PopularArticles } from "@/components/help/PopularArticles";
import { FeedbackWidget } from "@/components/help/FeedbackWidget";
import { Pagination } from "@/components/help/Pagination";

const PAGE_LIMIT = 20;

export default function HelpCenterPage() {
  const [searchInput, setSearchInput] = useState("");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const [articles, setArticles] = useState<HelpArticleDto[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [categories, setCategories] = useState<HelpCategoryDto[]>([]);
  const [catTotal, setCatTotal] = useState(0);

  const loadCategories = useCallback(async () => {
    const res = await apiGet<HelpCategoryDto[]>("/api/help/categories");
    if (res.success && res.data) {
      setCategories(res.data);
      setCatTotal(res.data.reduce((sum, c) => sum + c.count, 0));
    }
  }, []);

  const loadArticles = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({
      page: String(page),
      limit: String(PAGE_LIMIT),
    });
    if (category) params.set("category", category);
    if (query) params.set("search", query);

    const res = await apiGet<HelpArticleDto[]>(`/api/help/articles?${params}`);
    if (!res.success || !res.data) {
      setError(res.error ?? "Failed to load articles.");
      setLoading(false);
      return;
    }
    setArticles(res.data);
    setTotal(res.meta?.total ?? res.data.length);
    setLoading(false);
  }, [page, category, query]);

  useEffect(() => {
    void loadCategories();
  }, [loadCategories]);

  useEffect(() => {
    void loadArticles();
  }, [loadArticles]);

  // Debounce free-text search into the query used for fetching.
  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(total / PAGE_LIMIT)),
    [total]
  );

  const heading = query
    ? `Results for "${query}"`
    : category
    ? `${category} articles`
    : "Popular articles";

  return (
    <div>
      <ModuleHeader
        title="Help center"
        subtitle="Browse articles, open a support ticket, or send us feedback."
        action={
          <Link
            href="/console/help/tickets"
            className="text-sm bg-accent text-white rounded px-3 py-2 hover:opacity-90"
          >
            Support tickets
          </Link>
        }
      />

      <div className="mt-6">
        <HelpSearch
          value={searchInput}
          onChange={setSearchInput}
          onSubmit={() => {
            setQuery(searchInput.trim());
            setPage(1);
          }}
        />
      </div>

      <div className="mt-6 grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-6">
        <aside>
          <CategoryList
            categories={categories}
            active={category}
            totalCount={catTotal}
            onSelect={(c) => {
              setCategory(c);
              setPage(1);
            }}
          />
          <div className="mt-6">
            <FeedbackWidget />
          </div>
        </aside>

        <div>
          <PopularArticles
            articles={articles}
            loading={loading}
            error={error}
            heading={heading}
            onRetry={() => void loadArticles()}
          />
          {!loading && !error ? (
            <Pagination
              page={page}
              totalPages={totalPages}
              onPrev={() => setPage((p) => Math.max(1, p - 1))}
              onNext={() => setPage((p) => Math.min(totalPages, p + 1))}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
