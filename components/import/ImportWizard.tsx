"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  TARGET_FIELDS,
  type ImportBatch,
  type ImportFormat,
  type ImportTarget,
} from "@/lib/import/types";
import { parseImport, suggestMapping } from "@/lib/import/parse";
import {
  createBatch,
  commitBatch,
  listLibraries,
  type ReferenceLibraryDto,
} from "./api";
import { WizardSteps } from "./WizardSteps";
import { UploadStep } from "./UploadStep";
import { MappingStep } from "./MappingStep";
import { PreviewStep } from "./PreviewStep";
import { CommitStep } from "./CommitStep";

// Multi-step import wizard. Owns all cross-step state; each visual step is its own
// presentational component. Parsing runs entirely client-side for the preview;
// the server re-parses authoritatively when the batch is created.
export function ImportWizard() {
  const [step, setStep] = useState(0);
  const [target, setTarget] = useState<ImportTarget>("references");
  const [format, setFormat] = useState<ImportFormat>("bibtex");
  const [text, setText] = useState("");
  const [libraryId, setLibraryId] = useState("");
  const [mapping, setMapping] = useState<Record<string, string>>({});

  const [libraries, setLibraries] = useState<ReferenceLibraryDto[]>([]);
  const [librariesError, setLibrariesError] = useState<string | null>(null);

  const [batch, setBatch] = useState<ImportBatch | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [committed, setCommitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Parse the pasted text into a table for mapping + preview. Recomputed when the
  // text or format changes.
  const table = useMemo(() => parseImport(format, text), [format, text]);

  // Load reference libraries once (only relevant for the references target).
  useEffect(() => {
    let active = true;
    void (async () => {
      const res = await listLibraries();
      if (!active) return;
      if (!res.success || !res.data) {
        setLibrariesError(res.error ?? "Failed to load libraries.");
        return;
      }
      setLibraries(res.data.map((l) => ({ id: l.id, name: l.name })));
    })();
    return () => {
      active = false;
    };
  }, []);

  // When entering the mapping step, pre-fill a best-effort mapping.
  const goToMapping = useCallback(() => {
    const keys = TARGET_FIELDS[target].map((f) => f.key);
    setMapping((prev) =>
      Object.keys(prev).length > 0 ? prev : suggestMapping(keys, table.columns)
    );
    setStep(1);
  }, [target, table.columns]);

  const setMap = useCallback((fieldKey: string, column: string) => {
    setMapping((prev) => ({ ...prev, [fieldKey]: column }));
  }, []);

  // Reset the mapping when the target changes (field set differs).
  const changeTarget = useCallback((t: ImportTarget) => {
    setTarget(t);
    setMapping({});
  }, []);

  const submit = useCallback(async () => {
    setSubmitting(true);
    setError(null);
    const res = await createBatch({
      target,
      format,
      text,
      mapping,
      libraryId: target === "references" ? libraryId : undefined,
    });
    setSubmitting(false);
    if (!res.success || !res.data) {
      setError(res.error ?? "Failed to create batch.");
      return;
    }
    setBatch(res.data);
    setStep(3);
  }, [target, format, text, mapping, libraryId]);

  const commit = useCallback(async () => {
    if (!batch) return;
    setCommitting(true);
    setError(null);
    const res = await commitBatch(batch.id, {
      mapping,
      libraryId: target === "references" ? libraryId : undefined,
    });
    setCommitting(false);
    if (!res.success || !res.data) {
      setError(res.error ?? "Failed to commit batch.");
      return;
    }
    setBatch(res.data);
    setCommitted(true);
  }, [batch, mapping, target, libraryId]);

  return (
    <div className="space-y-6">
      <WizardSteps current={step} />

      {step === 0 ? (
        <UploadStep
          target={target}
          format={format}
          text={text}
          libraryId={libraryId}
          libraries={libraries}
          librariesError={librariesError}
          onTarget={changeTarget}
          onFormat={setFormat}
          onText={setText}
          onLibrary={setLibraryId}
          onNext={goToMapping}
        />
      ) : null}

      {step === 1 ? (
        <MappingStep
          target={target}
          columns={table.columns}
          mapping={mapping}
          onMap={setMap}
          onBack={() => setStep(0)}
          onNext={() => setStep(2)}
        />
      ) : null}

      {step === 2 ? (
        <PreviewStep
          target={target}
          mapping={mapping}
          rows={table.rows}
          totalRows={table.rows.length}
          onBack={() => setStep(1)}
          onConfirm={submit}
          submitting={submitting}
          error={error}
        />
      ) : null}

      {step === 3 && batch ? (
        <CommitStep
          batch={batch}
          committing={committing}
          committed={committed}
          error={error}
          onCommit={commit}
        />
      ) : null}
    </div>
  );
}
