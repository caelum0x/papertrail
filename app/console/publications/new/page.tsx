"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createPublication } from "../client";
import type { PublicationType } from "@/app/api/publications/lib/types";
import { NewPublicationForm } from "../_components/NewPublicationForm";

export default function NewPublicationPage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [type, setType] = useState<PublicationType>("manuscript");
  const [targetJournal, setTargetJournal] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onCreate = useCallback(async () => {
    setSubmitting(true);
    setError(null);
    const result = await createPublication({
      title: title.trim(),
      type,
      targetJournal: targetJournal.trim() ? targetJournal.trim() : null,
    });
    if (result.error || !result.data) {
      setError(result.error ?? "Failed to create publication.");
      setSubmitting(false);
      return;
    }
    router.push(`/console/publications/${result.data.id}`);
  }, [title, type, targetJournal, router]);

  return (
    <div className="max-w-2xl">
      <Link
        href="/console/publications"
        className="text-sm text-accent hover:underline"
      >
        ← Back to publications
      </Link>

      <h1 className="mt-4 text-2xl font-semibold text-ink/80">
        New publication
      </h1>
      <p className="mt-1 text-sm text-ink/40">
        Start a publication plan. You can attach verified claims and run MLR
        review once it exists.
      </p>

      <NewPublicationForm
        title={title}
        type={type}
        targetJournal={targetJournal}
        submitting={submitting}
        error={error}
        onTitleChange={setTitle}
        onTypeChange={setType}
        onTargetJournalChange={setTargetJournal}
        onSubmit={onCreate}
      />
    </div>
  );
}
