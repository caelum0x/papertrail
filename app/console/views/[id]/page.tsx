"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ViewHeader } from "@/components/views/ViewHeader";
import { ViewResultsPreview } from "@/components/views/ViewResultsPreview";
import {
  fetchView,
  updateView,
  deleteView,
  type SavedViewDto,
} from "@/components/views/api";

export default function ViewDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id;

  const [view, setView] = useState<SavedViewDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [togglingShare, setTogglingShare] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    const res = await fetchView(id);
    if (!res.success || !res.data) {
      setError(res.error ?? "Failed to load view.");
      setLoading(false);
      return;
    }
    setView(res.data);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleToggleShare = async () => {
    if (!id || !view) return;
    setTogglingShare(true);
    setActionError(null);
    const res = await updateView(id, { shared: !view.shared });
    setTogglingShare(false);
    if (!res.success || !res.data) {
      setActionError(res.error ?? "Failed to update sharing.");
      return;
    }
    setView(res.data);
  };

  const handleDelete = async () => {
    if (!id) return;
    if (typeof window !== "undefined") {
      const confirmed = window.confirm("Delete this view? This can't be undone.");
      if (!confirmed) return;
    }
    setDeleting(true);
    setActionError(null);
    const res = await deleteView(id);
    setDeleting(false);
    if (!res.success) {
      setActionError(res.error ?? "Failed to delete view.");
      return;
    }
    router.push("/console/views");
  };

  if (loading) {
    return <p className="text-sm text-ink/40">Loading view...</p>;
  }

  if (error || !view) {
    return (
      <div className="rounded-lg border border-ink/10 bg-white p-5">
        <p className="text-sm text-red-600">{error ?? "View not found."}</p>
        <button onClick={() => void load()} className="mt-2 text-sm text-accent">
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <ViewHeader
        view={view}
        togglingShare={togglingShare}
        deleting={deleting}
        onToggleShare={handleToggleShare}
        onDelete={handleDelete}
      />

      {actionError ? (
        <p className="text-sm text-red-600">{actionError}</p>
      ) : null}

      <ViewResultsPreview view={view} />
    </div>
  );
}
