"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import {
  apiGet,
  apiSend,
  orgHeaders,
  type ReferenceDto,
  type ReferenceLibraryDto,
} from "../api";
import { LibraryDetailHeader } from "../_components/LibraryDetailHeader";
import { ImportPanel } from "../_components/ImportPanel";
import { SearchBar } from "../_components/SearchBar";
import { ReferencesTable } from "../_components/ReferencesTable";
import { EmptyCard, ErrorCard } from "../_components/StateCard";
import { Pagination } from "../_components/Pagination";

const PAGE_LIMIT = 20;
type ImportFormat = "bibtex" | "ris";
type ExportFormat = "bibtex" | "ris" | "csv";

export default function LibraryDetailPage() {
  const params = useParams<{ id: string }>();
  const libraryId = params?.id ?? "";

  const [library, setLibrary] = useState<ReferenceLibraryDto | null>(null);
  const [references, setReferences] = useState<ReferenceDto[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [importOpen, setImportOpen] = useState(false);
  const [importFormat, setImportFormat] = useState<ImportFormat>("bibtex");
  const [importText, setImportText] = useState("");
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [importErr, setImportErr] = useState<string | null>(null);

  const loadLibrary = useCallback(async () => {
    if (!libraryId) return;
    const res = await apiGet<ReferenceLibraryDto>(
      `/api/reference-libraries/${libraryId}`
    );
    if (res.success && res.data) setLibrary(res.data);
  }, [libraryId]);

  const loadReferences = useCallback(
    async (p: number, term: string) => {
      if (!libraryId) return;
      setLoading(true);
      setError(null);
      const q = new URLSearchParams({
        libraryId,
        page: String(p),
        limit: String(PAGE_LIMIT),
      });
      if (term) q.set("search", term);
      const res = await apiGet<ReferenceDto[]>(`/api/references?${q.toString()}`);
      if (!res.success || !res.data) {
        setError(res.error ?? "Failed to load references.");
        setLoading(false);
        return;
      }
      setReferences(res.data);
      setTotal(res.meta?.total ?? res.data.length);
      setLoading(false);
    },
    [libraryId]
  );

  useEffect(() => {
    void loadLibrary();
  }, [loadLibrary]);

  useEffect(() => {
    void loadReferences(page, search);
  }, [loadReferences, page, search]);

  const onSearch = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      setPage(1);
      setSearch(searchInput.trim());
    },
    [searchInput]
  );

  const onImport = useCallback(async () => {
    if (!importText.trim()) {
      setImportErr("Paste BibTeX or RIS text to import.");
      return;
    }
    setImporting(true);
    setImportErr(null);
    setImportMsg(null);
    const res = await apiSend<{ imported: number }>(
      "/api/references/import",
      "POST",
      { libraryId, format: importFormat, text: importText }
    );
    setImporting(false);
    if (!res.success || !res.data) {
      setImportErr(res.error ?? "Import failed.");
      return;
    }
    setImportMsg(`Imported ${res.data.imported} reference(s).`);
    setImportText("");
    setPage(1);
    setSearch("");
    setSearchInput("");
    void loadLibrary();
    void loadReferences(1, "");
  }, [importText, importFormat, libraryId, loadLibrary, loadReferences]);

  const onExport = useCallback(
    async (format: ExportFormat) => {
      const res = await fetch(
        `/api/references/export?libraryId=${libraryId}&format=${format}`,
        { headers: { ...orgHeaders() }, cache: "no-store" }
      );
      if (!res.ok) return;
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = disposition.match(/filename="([^"]+)"/);
      const filename =
        match?.[1] ??
        `references.${format === "csv" ? "csv" : format === "ris" ? "ris" : "bib"}`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    },
    [libraryId]
  );

  const onDelete = useCallback(
    async (id: string) => {
      const res = await apiSend<{ deleted: boolean }>(
        `/api/references/${id}`,
        "DELETE"
      );
      if (res.success) {
        void loadLibrary();
        void loadReferences(page, search);
      }
    },
    [loadLibrary, loadReferences, page, search]
  );

  const totalPages = Math.max(1, Math.ceil(total / PAGE_LIMIT));

  return (
    <div>
      <LibraryDetailHeader
        library={library}
        total={total}
        importOpen={importOpen}
        onToggleImport={() => setImportOpen((v) => !v)}
        onExport={(f) => void onExport(f)}
      />

      {importOpen ? (
        <ImportPanel
          format={importFormat}
          text={importText}
          importing={importing}
          message={importMsg}
          error={importErr}
          onFormatChange={setImportFormat}
          onTextChange={setImportText}
          onImport={() => void onImport()}
        />
      ) : null}

      <SearchBar
        value={searchInput}
        activeSearch={search}
        onChange={setSearchInput}
        onSubmit={onSearch}
        onClear={() => {
          setSearch("");
          setSearchInput("");
          setPage(1);
        }}
      />

      <div className="mt-4">
        {loading ? (
          <p className="text-sm text-ink/40">Loading references...</p>
        ) : error ? (
          <ErrorCard
            message={error}
            onRetry={() => void loadReferences(page, search)}
          />
        ) : references.length === 0 ? (
          <EmptyCard
            title={
              search ? "No references match your search." : "No references yet."
            }
            hint={search ? undefined : "Use Import to add BibTeX or RIS citations."}
          />
        ) : (
          <ReferencesTable
            references={references}
            onDelete={(id) => void onDelete(id)}
          />
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
