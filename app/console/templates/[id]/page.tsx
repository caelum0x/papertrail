"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { TemplateHeader } from "@/components/templates/TemplateHeader";
import { Tabs, type TabItem } from "@/components/templates/Tabs";
import {
  TemplateEditor,
  type TemplateEditorValues,
} from "@/components/templates/TemplateEditor";
import { TemplatePreview } from "@/components/templates/TemplatePreview";
import { apiGet, apiSend, type TemplateDto } from "../api";

const TABS: TabItem[] = [
  { id: "editor", label: "Editor" },
  { id: "preview", label: "Preview" },
];

export default function TemplateDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id;

  const [template, setTemplate] = useState<TemplateDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>("editor");

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    const res = await apiGet<TemplateDto>(`/api/templates/${id}`);
    if (!res.success || !res.data) {
      setError(res.error ?? "Failed to load template.");
      setLoading(false);
      return;
    }
    setTemplate(res.data);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSave = async (values: TemplateEditorValues) => {
    if (!id) return;
    setSaving(true);
    setSaveError(null);
    setSavedNote(false);
    const res = await apiSend<TemplateDto>(`/api/templates/${id}`, "PATCH", {
      name: values.name,
      description: values.description.trim() ? values.description.trim() : null,
      category: values.category.trim() ? values.category.trim() : null,
      body: values.body,
    });
    setSaving(false);
    if (!res.success || !res.data) {
      setSaveError(res.error ?? "Failed to save changes.");
      return;
    }
    setTemplate(res.data);
    setSavedNote(true);
  };

  const handleDuplicate = async () => {
    if (!id) return;
    setDuplicating(true);
    const res = await apiSend<TemplateDto>(
      `/api/templates/${id}/duplicate`,
      "POST"
    );
    setDuplicating(false);
    if (res.success && res.data) {
      router.push(`/console/templates/${res.data.id}`);
    }
  };

  const handleDelete = async () => {
    if (!id) return;
    if (typeof window !== "undefined") {
      const confirmed = window.confirm(
        "Delete this template? This can't be undone."
      );
      if (!confirmed) return;
    }
    setDeleting(true);
    const res = await apiSend(`/api/templates/${id}`, "DELETE");
    setDeleting(false);
    if (res.success) {
      router.push("/console/templates");
    }
  };

  if (loading) {
    return <p className="text-sm text-ink/40">Loading template...</p>;
  }

  if (error || !template) {
    return (
      <div className="bg-white border border-ink/10 rounded-lg p-5">
        <p className="text-sm text-red-600">{error ?? "Template not found."}</p>
        <button onClick={() => void load()} className="mt-2 text-sm text-accent">
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <TemplateHeader
        template={template}
        duplicating={duplicating}
        deleting={deleting}
        onDuplicate={handleDuplicate}
        onDelete={handleDelete}
      />

      <Tabs tabs={TABS} active={activeTab} onChange={setActiveTab} />

      {savedNote && activeTab === "editor" ? (
        <p className="text-sm text-emerald-700">Changes saved.</p>
      ) : null}

      {activeTab === "editor" ? (
        <TemplateEditor
          template={template}
          saving={saving}
          error={saveError}
          onSave={handleSave}
        />
      ) : (
        <TemplatePreview template={template} />
      )}
    </div>
  );
}
