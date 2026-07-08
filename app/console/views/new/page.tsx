"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ModuleHeader } from "@/components/views/ModuleHeader";
import {
  ViewBuilder,
  type ViewBuilderValues,
} from "@/components/views/ViewBuilder";
import {
  createView,
  isViewResource,
  type ViewResource,
} from "@/components/views/api";

function NewViewForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Allow list pages to deep-link into the builder pre-scoped to a resource.
  const resourceParam = searchParams.get("resource");
  const initialResource: ViewResource | undefined = isViewResource(resourceParam)
    ? resourceParam
    : undefined;

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (values: ViewBuilderValues) => {
    setSaving(true);
    setError(null);
    const res = await createView({
      name: values.name,
      resource: values.resource,
      query: values.query,
      shared: values.shared,
    });
    setSaving(false);
    if (!res.success || !res.data) {
      setError(res.error ?? "Failed to save view.");
      return;
    }
    router.push(`/console/views/${res.data.id}`);
  };

  return (
    <div className="space-y-6">
      <ModuleHeader
        title="New saved view"
        description="Build a reusable query for a resource and optionally share it."
        secondaryHref="/console/views"
        secondaryLabel="Back to views"
      />

      <ViewBuilder
        initial={initialResource ? { resource: initialResource } : undefined}
        saving={saving}
        error={error}
        submitLabel="Save view"
        onSubmit={handleSubmit}
        onCancel={() => router.push("/console/views")}
      />
    </div>
  );
}

export default function NewViewPage() {
  return (
    <Suspense
      fallback={<p className="text-sm text-ink/40">Loading builder...</p>}
    >
      <NewViewForm />
    </Suspense>
  );
}
