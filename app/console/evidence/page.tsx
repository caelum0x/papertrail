"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { EvidenceItem, EvidenceSourceType } from "@/lib/evidence/types";
import {
  fetchEvidenceList,
  createEvidenceItem,
  type CreateEvidencePayload,
} from "@/components/evidence/api";
import { ModuleHeader } from "./_components/ModuleHeader";
import { EvidenceForm } from "./_components/EvidenceForm";
import { EvidenceFilters } from "./_components/EvidenceFilters";
import { EvidenceList } from "./_components/EvidenceList";
import { EvidencePagination } from "./_components/EvidencePagination";
import { ListLoading, ListError, ListEmpty } from "./_components/ListStates";

const PAGE_SIZE = 20;

const EMPTY_FORM: CreateEvidencePayload = {
  source_type: "pubmed",
  title: "",
  external_id: "",
  url: "",
  notes: "",
  tags: [],
};

function parseTagInput(raw: string): string[] {
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

export default function EvidenceLibraryPage() {
  const [items, setItems] = useState<EvidenceItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [typeFilter, setTypeFilter] = useState<EvidenceSourceType | "">("");
  const [tagFilter, setTagFilter] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<CreateEvidencePayload>(EMPTY_FORM);
  const [tagsRaw, setTagsRaw] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => clearTimeout(handle);
  }, [q]);

  // Reset to first page whenever a filter changes.
  useEffect(() => {
    setPage(1);
  }, [debouncedQ, typeFilter, tagFilter]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchEvidenceList({
        q: debouncedQ || undefined,
        type: typeFilter,
        tag: tagFilter.trim() || undefined,
        page,
        limit: PAGE_SIZE,
      });
      setItems(res.items);
      setTotal(res.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [debouncedQ, typeFilter, tagFilter, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(total / PAGE_SIZE)),
    [total]
  );

  const onSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setSubmitting(true);
      setFormError(null);
      try {
        const payload: CreateEvidencePayload = {
          source_type: form.source_type,
          title: form.title.trim(),
          external_id: form.external_id?.trim() || null,
          url: form.url?.trim() || null,
          notes: form.notes?.trim() || null,
          tags: parseTagInput(tagsRaw),
        };
        await createEvidenceItem(payload);
        setForm(EMPTY_FORM);
        setTagsRaw("");
        setShowForm(false);
        setPage(1);
        await load();
      } catch (err) {
        setFormError(
          err instanceof Error ? err.message : "Couldn't add the item."
        );
      } finally {
        setSubmitting(false);
      }
    },
    [form, tagsRaw, load]
  );

  return (
    <div>
      <ModuleHeader
        title="Evidence library"
        subtitle="Curated PubMed articles, ClinicalTrials.gov trials, and uploaded documents for this workspace."
        action={
          <button
            onClick={() => {
              setShowForm((v) => !v);
              setFormError(null);
            }}
            className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            {showForm ? "Cancel" : "Add evidence"}
          </button>
        }
      />

      {showForm ? (
        <EvidenceForm
          form={form}
          tagsRaw={tagsRaw}
          submitting={submitting}
          error={formError}
          onFieldChange={(patch) => setForm((f) => ({ ...f, ...patch }))}
          onTagsRawChange={setTagsRaw}
          onSubmit={onSubmit}
        />
      ) : null}

      <EvidenceFilters
        q={q}
        typeFilter={typeFilter}
        tagFilter={tagFilter}
        onQChange={setQ}
        onTypeChange={setTypeFilter}
        onTagChange={setTagFilter}
      />

      <div className="mt-4">
        {loading ? (
          <ListLoading />
        ) : error ? (
          <ListError message={error} onRetry={() => void load()} />
        ) : items.length === 0 ? (
          <ListEmpty />
        ) : (
          <EvidenceList items={items} />
        )}
      </div>

      {!loading && !error && total > PAGE_SIZE ? (
        <EvidencePagination
          total={total}
          page={page}
          totalPages={totalPages}
          onPrev={() => setPage((p) => Math.max(1, p - 1))}
          onNext={() => setPage((p) => Math.min(totalPages, p + 1))}
        />
      ) : null}
    </div>
  );
}
