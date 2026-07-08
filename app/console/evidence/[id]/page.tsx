"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import type { EvidenceItem } from "@/lib/evidence/types";
import {
  fetchEvidenceItem,
  updateEvidenceItem,
  deleteEvidenceItem,
  addEvidenceTags,
} from "@/components/evidence/api";
import { EvidenceDetailHeader } from "../_components/EvidenceDetailHeader";
import { EvidenceMeta } from "../_components/EvidenceMeta";
import { TagsEditor } from "../_components/TagsEditor";
import { NotesEditor } from "../_components/NotesEditor";
import { EvidenceNotFound } from "../_components/EvidenceNotFound";

export default function EvidenceDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const [item, setItem] = useState<EvidenceItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [notes, setNotes] = useState("");
  const [savingNotes, setSavingNotes] = useState(false);
  const [newTag, setNewTag] = useState("");
  const [tagError, setTagError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchEvidenceItem(id);
      setItem(data);
      setNotes(data.notes ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const onSaveNotes = useCallback(async () => {
    if (!id) return;
    setSavingNotes(true);
    setActionError(null);
    try {
      const updated = await updateEvidenceItem(id, {
        notes: notes.trim() || null,
      });
      setItem(updated);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Couldn't save notes.");
    } finally {
      setSavingNotes(false);
    }
  }, [id, notes]);

  const onAddTag = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!id) return;
      const tag = newTag.trim();
      if (!tag) return;
      setTagError(null);
      try {
        const updated = await addEvidenceTags(id, [tag]);
        setItem(updated);
        setNewTag("");
      } catch (err) {
        setTagError(err instanceof Error ? err.message : "Couldn't add tag.");
      }
    },
    [id, newTag]
  );

  const onRemoveTag = useCallback(
    async (tag: string) => {
      if (!id || !item) return;
      setTagError(null);
      try {
        const remaining = item.tags.filter((t) => t !== tag);
        const updated = await updateEvidenceItem(id, { tags: remaining });
        setItem(updated);
      } catch (err) {
        setTagError(err instanceof Error ? err.message : "Couldn't remove tag.");
      }
    },
    [id, item]
  );

  const onDelete = useCallback(async () => {
    if (!id) return;
    if (!window.confirm("Delete this evidence item? This cannot be undone.")) {
      return;
    }
    setDeleting(true);
    setActionError(null);
    try {
      await deleteEvidenceItem(id);
      router.push("/console/evidence");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Couldn't delete.");
      setDeleting(false);
    }
  }, [id, router]);

  if (loading) {
    return (
      <div className="bg-white border border-ink/15 rounded-lg p-8 text-center text-sm text-ink/40">
        Loading evidence item...
      </div>
    );
  }

  if (error || !item) {
    return (
      <EvidenceNotFound
        message={error ?? "Evidence item not found."}
        onRetry={() => void load()}
      />
    );
  }

  return (
    <div className="max-w-2xl">
      <Link
        href="/console/evidence"
        className="text-sm text-accent hover:underline"
      >
        ← Back to library
      </Link>

      <EvidenceDetailHeader item={item} deleting={deleting} onDelete={onDelete} />

      {actionError ? (
        <p className="mt-3 text-sm text-red-600">{actionError}</p>
      ) : null}

      <EvidenceMeta item={item} />

      <TagsEditor
        tags={item.tags}
        newTag={newTag}
        error={tagError}
        onNewTagChange={setNewTag}
        onAddTag={onAddTag}
        onRemoveTag={onRemoveTag}
      />

      <NotesEditor
        notes={notes}
        saving={savingNotes}
        dirty={notes !== (item.notes ?? "")}
        onNotesChange={setNotes}
        onSave={onSaveNotes}
      />
    </div>
  );
}
