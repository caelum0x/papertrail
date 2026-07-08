"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiSend, type ReferenceLibraryDto } from "../api";
import { LibraryFormFields } from "../_components/LibraryFormFields";

export default function NewReferenceLibraryPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [projectId, setProjectId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    setSubmitting(true);
    setError(null);

    const payload: Record<string, unknown> = { name: name.trim() };
    if (projectId.trim()) payload.projectId = projectId.trim();

    const res = await apiSend<ReferenceLibraryDto>(
      "/api/reference-libraries",
      "POST",
      payload
    );
    if (!res.success || !res.data) {
      setError(res.error ?? "Failed to create library.");
      setSubmitting(false);
      return;
    }
    router.push(`/console/references/${res.data.id}`);
  }

  return (
    <div className="max-w-2xl">
      <div className="flex items-center gap-2 text-sm text-ink/40">
        <Link href="/console/references" className="hover:text-accent">
          Reference libraries
        </Link>
        <span>/</span>
        <span className="text-ink/60">New</span>
      </div>

      <h1 className="mt-2 text-2xl font-semibold text-ink/80">
        Create a reference library
      </h1>
      <p className="mt-1 text-sm text-ink/40">
        A named collection of citations you can import into and export from.
      </p>

      <form onSubmit={onSubmit} className="mt-6 space-y-5">
        <LibraryFormFields
          name={name}
          projectId={projectId}
          onNameChange={setName}
          onProjectIdChange={setProjectId}
        />

        {error ? <p className="text-sm text-red-700">{error}</p> : null}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={submitting}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? "Creating..." : "Create library"}
          </button>
          <Link
            href="/console/references"
            className="text-sm text-ink/60 hover:text-ink/80"
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
