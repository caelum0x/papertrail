"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  TemplateForm,
  type TemplateFormValues,
} from "@/components/templates/TemplateForm";
import { apiSend, type TemplateDto } from "../api";

export default function NewTemplatePage() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (values: TemplateFormValues) => {
    setSubmitting(true);
    setError(null);
    const res = await apiSend<TemplateDto>("/api/templates", "POST", {
      kind: values.kind,
      name: values.name,
      description: values.description.trim() || undefined,
      category: values.category.trim() || undefined,
      body: values.body,
    });
    setSubmitting(false);
    if (!res.success || !res.data) {
      setError(res.error ?? "Failed to create template.");
      return;
    }
    router.push(`/console/templates/${res.data.id}`);
  };

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/console/templates"
          className="text-sm text-ink/40 hover:text-accent"
        >
          &larr; Templates
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-ink/80">New template</h1>
        <p className="mt-1 text-sm text-ink/40">
          Define the kind, metadata, and fields for a reusable template.
        </p>
      </div>

      <TemplateForm
        submitLabel="Create template"
        submitting={submitting}
        error={error}
        onSubmit={handleSubmit}
        onCancel={() => router.push("/console/templates")}
      />
    </div>
  );
}
