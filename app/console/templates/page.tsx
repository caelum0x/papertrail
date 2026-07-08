"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ModuleHeader } from "@/components/templates/ModuleHeader";
import { CategoryFilter } from "@/components/templates/CategoryFilter";
import { TemplateGrid } from "@/components/templates/TemplateGrid";
import { EmptyState } from "@/components/templates/EmptyState";
import { Pagination } from "@/components/templates/Pagination";
import {
  apiGet,
  apiSend,
  TEMPLATE_KINDS,
  type CategoryStat,
  type TemplateDto,
  type TemplateKind,
} from "./api";

const PAGE_LIMIT = 12;

function isKind(value: string | null): value is TemplateKind {
  return value !== null && (TEMPLATE_KINDS as readonly string[]).includes(value);
}

function TemplatesGridPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const initialKind = searchParams.get("kind");
  const initialCategory = searchParams.get("category");

  const [kind, setKind] = useState<TemplateKind | "all">(
    isKind(initialKind) ? initialKind : "all"
  );
  const [category, setCategory] = useState<string | "all">(
    initialCategory ?? "all"
  );

  const [templates, setTemplates] = useState<TemplateDto[]>([]);
  const [categories, setCategories] = useState<CategoryStat[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const loadCategories = useCallback(async () => {
    const res = await apiGet<CategoryStat[]>("/api/templates/categories");
    if (res.success && res.data) {
      setCategories(res.data);
    }
  }, []);

  const load = useCallback(
    async (p: number, k: TemplateKind | "all", c: string | "all") => {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams({
        page: String(p),
        limit: String(PAGE_LIMIT),
      });
      if (k !== "all") params.set("kind", k);
      if (c !== "all") params.set("category", c);

      const res = await apiGet<TemplateDto[]>(`/api/templates?${params.toString()}`);
      if (!res.success || !res.data) {
        setError(res.error ?? "Failed to load templates.");
        setLoading(false);
        return;
      }
      setTemplates(res.data);
      setTotal(res.meta?.total ?? res.data.length);
      setLoading(false);
    },
    []
  );

  useEffect(() => {
    void loadCategories();
  }, [loadCategories]);

  useEffect(() => {
    void load(page, kind, category);
  }, [load, page, kind, category]);

  const handleKindChange = (next: TemplateKind | "all") => {
    setKind(next);
    setPage(1);
  };

  const handleCategoryChange = (next: string | "all") => {
    setCategory(next);
    setPage(1);
  };

  const handleDuplicate = async (id: string) => {
    setDuplicatingId(id);
    setActionError(null);
    const res = await apiSend<TemplateDto>(
      `/api/templates/${id}/duplicate`,
      "POST"
    );
    setDuplicatingId(null);
    if (!res.success || !res.data) {
      setActionError(res.error ?? "Failed to duplicate template.");
      return;
    }
    router.push(`/console/templates/${res.data.id}`);
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_LIMIT));
  const hasFilters = kind !== "all" || category !== "all";

  return (
    <div className="space-y-6">
      <ModuleHeader
        title="Templates"
        description="Reusable claim, report, verification, and document templates."
        actionHref="/console/templates/new"
        actionLabel="New template"
        secondaryHref="/console/templates/categories"
        secondaryLabel="Categories"
      />

      <CategoryFilter
        kind={kind}
        category={category}
        categories={categories}
        onKindChange={handleKindChange}
        onCategoryChange={handleCategoryChange}
      />

      {actionError ? (
        <p className="text-sm text-red-600">{actionError}</p>
      ) : null}

      {loading ? (
        <p className="text-sm text-ink/40">Loading templates...</p>
      ) : error ? (
        <div className="bg-white border border-ink/10 rounded-lg p-5">
          <p className="text-sm text-red-600">{error}</p>
          <button
            onClick={() => void load(page, kind, category)}
            className="mt-2 text-sm text-accent"
          >
            Retry
          </button>
        </div>
      ) : templates.length === 0 ? (
        <EmptyState
          title={hasFilters ? "No templates match these filters" : "No templates yet"}
          message={
            hasFilters
              ? "Try a different kind or category, or create a new template."
              : "Create your first template to standardize how claims, reports, and documents are captured."
          }
          actionHref="/console/templates/new"
          actionLabel="New template"
        />
      ) : (
        <TemplateGrid
          templates={templates}
          duplicatingId={duplicatingId}
          onDuplicate={handleDuplicate}
        />
      )}

      {!loading && !error && total > PAGE_LIMIT ? (
        <Pagination
          page={page}
          totalPages={totalPages}
          onPageChange={setPage}
        />
      ) : null}
    </div>
  );
}

export default function TemplatesPage() {
  return (
    <Suspense fallback={<p className="text-sm text-ink/40">Loading templates...</p>}>
      <TemplatesGridPage />
    </Suspense>
  );
}
