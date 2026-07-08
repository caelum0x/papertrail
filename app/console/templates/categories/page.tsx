"use client";

import { useCallback, useEffect, useState } from "react";
import { ModuleHeader } from "@/components/templates/ModuleHeader";
import { CategoryManager } from "@/components/templates/CategoryManager";
import { apiGet, type CategoryStat } from "../api";

export default function TemplateCategoriesPage() {
  const [categories, setCategories] = useState<CategoryStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await apiGet<CategoryStat[]>("/api/templates/categories");
    if (!res.success || !res.data) {
      setError(res.error ?? "Failed to load categories.");
      setLoading(false);
      return;
    }
    setCategories(res.data);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6">
      <ModuleHeader
        title="Categories"
        description="Categories in use across your templates. Click one to filter the grid."
        secondaryHref="/console/templates"
        secondaryLabel="Back to templates"
        actionHref="/console/templates/new"
        actionLabel="New template"
      />

      {loading ? (
        <p className="text-sm text-ink/40">Loading categories...</p>
      ) : error ? (
        <div className="bg-white border border-ink/10 rounded-lg p-5">
          <p className="text-sm text-red-600">{error}</p>
          <button onClick={() => void load()} className="mt-2 text-sm text-accent">
            Retry
          </button>
        </div>
      ) : (
        <CategoryManager categories={categories} />
      )}
    </div>
  );
}
