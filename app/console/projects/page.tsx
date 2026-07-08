"use client";

import { useCallback, useEffect, useState } from "react";
import { apiGet, apiSend } from "@/components/projects/api";
import type { Project } from "@/components/projects/types";
import { ModuleHeader } from "./_components/ModuleHeader";
import { NewProjectForm } from "./_components/NewProjectForm";
import { ProjectList } from "./_components/ProjectList";
import { EmptyState } from "./_components/EmptyState";
import { ErrorCard } from "./_components/ErrorCard";
import { Pagination } from "./_components/Pagination";

const PAGE_LIMIT = 20;

export default function ProjectsListPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async (p: number) => {
    setLoading(true);
    setError(null);
    const res = await apiGet<Project[]>(
      `/api/projects?page=${p}&limit=${PAGE_LIMIT}`
    );
    if (!res.success || !res.data) {
      setError(res.error ?? "Failed to load projects.");
      setLoading(false);
      return;
    }
    setProjects(res.data);
    setTotal(res.meta?.total ?? res.data.length);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load(page);
  }, [load, page]);

  const onCreate = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!name.trim()) {
        setFormError("Name is required.");
        return;
      }
      setSubmitting(true);
      setFormError(null);
      const res = await apiSend<Project>("/api/projects", "POST", {
        name: name.trim(),
        description: description.trim() || null,
      });
      setSubmitting(false);
      if (!res.success) {
        setFormError(res.error ?? "Failed to create project.");
        return;
      }
      setName("");
      setDescription("");
      setShowForm(false);
      setPage(1);
      void load(1);
    },
    [name, description, load]
  );

  const totalPages = Math.max(1, Math.ceil(total / PAGE_LIMIT));

  return (
    <div>
      <ModuleHeader
        title="Projects"
        subtitle="Workspaces for organizing claims, evidence, and reviews."
        action={
          <button
            onClick={() => setShowForm((v) => !v)}
            className="text-sm bg-accent text-white rounded px-3 py-2 hover:opacity-90"
          >
            {showForm ? "Cancel" : "New project"}
          </button>
        }
      />

      {showForm ? (
        <NewProjectForm
          name={name}
          description={description}
          submitting={submitting}
          error={formError}
          onNameChange={setName}
          onDescriptionChange={setDescription}
          onSubmit={onCreate}
        />
      ) : null}

      <div className="mt-6">
        {loading ? (
          <p className="text-sm text-ink/40">Loading projects...</p>
        ) : error ? (
          <ErrorCard message={error} onRetry={() => void load(page)} />
        ) : projects.length === 0 ? (
          <EmptyState
            title="No projects yet."
            hint="Create your first workspace to get started."
          />
        ) : (
          <ProjectList projects={projects} />
        )}
      </div>

      {!loading && !error && total > PAGE_LIMIT ? (
        <Pagination
          page={page}
          totalPages={totalPages}
          onPrev={() => setPage((p) => Math.max(1, p - 1))}
          onNext={() => setPage((p) => Math.min(totalPages, p + 1))}
        />
      ) : null}
    </div>
  );
}
