"use client";

import { useMemo, useState } from "react";
import type { CatalogEntryView } from "./types";
import { ConfigForm, buildConfig } from "./ConfigForm";
import { createConnector, type CreateConnectorInput } from "./api";
import type { Connector } from "@/lib/connectors/types";

interface InstallModalProps {
  entry: CatalogEntryView;
  onClose: () => void;
  onInstalled: (connector: Connector) => void;
}

// Modal to install a connector: name + provider-specific config fields. Submits
// to POST /api/connectors; the server re-validates the config against the
// provider schema, so client validation here is light.
export function InstallModal({ entry, onClose, onInstalled }: InstallModalProps) {
  const [name, setName] = useState(entry.name);
  const [values, setValues] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const missingRequired = useMemo(() => {
    if (name.trim() === "") return true;
    return entry.fields.some(
      (f) => f.required && (values[f.key] ?? "").trim() === ""
    );
  }, [entry.fields, name, values]);

  const onFieldChange = (key: string, value: string) =>
    setValues((prev) => ({ ...prev, [key]: value }));

  const onSubmit = async () => {
    setSubmitting(true);
    setError(null);
    const input: CreateConnectorInput = {
      provider: entry.provider,
      name: name.trim(),
      config: buildConfig(entry.fields, values),
    };
    const res = await createConnector(input);
    if (res.error || !res.data) {
      setError(res.error ?? "Failed to install connector.");
      setSubmitting(false);
      return;
    }
    onInstalled(res.data);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-md rounded-lg border border-ink/10 bg-white p-5 shadow-lg">
        <div className="flex items-start justify-between">
          <h2 className="text-lg font-semibold text-ink/80">
            Install {entry.name}
          </h2>
          <button
            onClick={onClose}
            className="text-sm text-ink/40 hover:text-ink/80"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <p className="mt-1 text-sm text-ink/40">{entry.description}</p>

        <div className="mt-4">
          <label className="block text-xs font-medium text-ink/60">
            Connector name<span className="text-accent"> *</span>
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={submitting}
            className="mt-1 w-full rounded-md border border-ink/15 bg-white px-2 py-1.5 text-sm text-ink/80 disabled:opacity-40"
          />
        </div>

        <div className="mt-4">
          <ConfigForm
            fields={entry.fields}
            values={values}
            onChange={onFieldChange}
            disabled={submitting}
          />
        </div>

        {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={submitting}
            className="rounded-md border border-ink/15 bg-white px-3 py-1.5 text-sm text-ink/80 disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            onClick={onSubmit}
            disabled={submitting || missingRequired}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
          >
            {submitting ? "Installing…" : "Install"}
          </button>
        </div>
      </div>
    </div>
  );
}
