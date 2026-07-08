"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { scienceGet, scienceSend } from "@/lib/science/apiClient";
import type { ScienceConnection } from "@/lib/science/clientTypes";

interface ConnectionsResponse {
  connections: ScienceConnection[];
  workbench: { configured: boolean; endpoint: string | null; reason: string | null };
}

const STATUS_OPTIONS = ["disabled", "enabled", "error"] as const;

export default function ScienceSettingsPage() {
  const [data, setData] = useState<ConnectionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [workspaceId, setWorkspaceId] = useState("");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<(typeof STATUS_OPTIONS)[number]>("disabled");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await scienceGet<ConnectionsResponse>("/api/science/connections");
    setLoading(false);
    if (!res.success || !res.data) {
      setError(res.error ?? "Failed to load connections.");
      return;
    }
    setData(res.data);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onSave = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!name.trim()) {
        setFormError("Name is required.");
        return;
      }
      setSaving(true);
      setFormError(null);
      const res = await scienceSend<ScienceConnection>(
        "/api/science/connections",
        "POST",
        {
          name: name.trim(),
          status,
          config: {
            endpoint: endpoint.trim() || null,
            workspaceId: workspaceId.trim() || null,
            notes: notes.trim() || null,
          },
        }
      );
      setSaving(false);
      if (!res.success) {
        setFormError(res.error ?? "Failed to save connection.");
        return;
      }
      setName("");
      setEndpoint("");
      setWorkspaceId("");
      setNotes("");
      setStatus("disabled");
      setShowForm(false);
      void load();
    },
    [name, endpoint, workspaceId, notes, status, load]
  );

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink/80">
            Claude Science connections
          </h1>
          <p className="mt-1 text-sm text-ink/40">
            Configure the Claude Science workbench beta for this organization.
          </p>
        </div>
        <Link href="/console/science" className="text-sm text-accent hover:underline">
          Research sessions
        </Link>
      </div>

      {loading ? (
        <p className="mt-6 text-sm text-ink/40">Loading connections...</p>
      ) : error ? (
        <div className="mt-6 bg-white border border-ink/15 rounded-lg p-5">
          <p className="text-sm text-red-600">{error}</p>
          <button onClick={() => void load()} className="mt-2 text-sm text-accent">
            Retry
          </button>
        </div>
      ) : data ? (
        <>
          <div
            className={`mt-6 rounded-lg border p-4 text-sm ${
              data.workbench.configured
                ? "border-accent/20 bg-accent/5 text-ink/70"
                : "border-ink/10 bg-paper text-ink/60"
            }`}
          >
            <p className="font-medium text-ink/80">
              Workbench status:{" "}
              {data.workbench.configured ? "Configured" : "Not configured"}
            </p>
            {data.workbench.endpoint ? (
              <p className="mt-1 text-xs text-ink/50">
                Endpoint: {data.workbench.endpoint}
              </p>
            ) : null}
            {data.workbench.reason ? (
              <p className="mt-1 text-xs text-ink/50">{data.workbench.reason}</p>
            ) : null}
          </div>

          <div className="mt-6 flex items-center justify-between">
            <h2 className="text-sm font-medium text-ink/70">Saved connections</h2>
            <button
              onClick={() => setShowForm((v) => !v)}
              className="text-sm bg-accent text-white rounded px-3 py-2 hover:opacity-90"
            >
              {showForm ? "Cancel" : "New connection"}
            </button>
          </div>

          {showForm ? (
            <form
              onSubmit={onSave}
              className="mt-3 bg-white border border-ink/15 rounded-lg p-5 space-y-3"
            >
              <div>
                <label className="block text-sm text-ink/70 mb-1">Name</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={200}
                  className="w-full text-sm border border-ink/15 rounded px-3 py-2 focus:outline-none focus:border-accent"
                  placeholder="e.g. Gladstone workbench"
                />
              </div>
              <div>
                <label className="block text-sm text-ink/70 mb-1">
                  Endpoint <span className="text-ink/35">(optional)</span>
                </label>
                <input
                  value={endpoint}
                  onChange={(e) => setEndpoint(e.target.value)}
                  maxLength={500}
                  className="w-full text-sm border border-ink/15 rounded px-3 py-2 focus:outline-none focus:border-accent"
                  placeholder="https://..."
                />
              </div>
              <div>
                <label className="block text-sm text-ink/70 mb-1">
                  Workspace ID <span className="text-ink/35">(optional)</span>
                </label>
                <input
                  value={workspaceId}
                  onChange={(e) => setWorkspaceId(e.target.value)}
                  maxLength={200}
                  className="w-full text-sm border border-ink/15 rounded px-3 py-2 focus:outline-none focus:border-accent"
                />
              </div>
              <div>
                <label className="block text-sm text-ink/70 mb-1">
                  Notes <span className="text-ink/35">(optional)</span>
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  maxLength={2000}
                  rows={2}
                  className="w-full text-sm border border-ink/15 rounded px-3 py-2 focus:outline-none focus:border-accent"
                />
              </div>
              <div>
                <label className="block text-sm text-ink/70 mb-1">Status</label>
                <select
                  value={status}
                  onChange={(e) =>
                    setStatus(e.target.value as (typeof STATUS_OPTIONS)[number])
                  }
                  className="text-sm border border-ink/15 rounded px-2 py-2 focus:outline-none focus:border-accent capitalize"
                >
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s} className="capitalize">
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <p className="text-xs text-ink/40">
                The workbench API secret is set via an environment variable and is
                never stored here.
              </p>
              {formError ? (
                <p className="text-sm text-red-600">{formError}</p>
              ) : null}
              <button
                type="submit"
                disabled={saving}
                className="text-sm bg-accent text-white rounded px-3 py-2 hover:opacity-90 disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save connection"}
              </button>
            </form>
          ) : null}

          <div className="mt-4">
            {data.connections.length === 0 ? (
              <div className="bg-white border border-ink/15 rounded-lg p-6 text-center">
                <p className="text-sm text-ink/60">No connections configured.</p>
              </div>
            ) : (
              <ul className="space-y-2">
                {data.connections.map((c) => (
                  <li
                    key={c.id}
                    className="bg-white border border-ink/15 rounded-lg p-4"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-ink/80">{c.name}</span>
                      <span
                        className={`text-xs rounded px-2 py-0.5 ${
                          c.status === "enabled"
                            ? "bg-accent/10 text-accent"
                            : c.status === "error"
                            ? "bg-red-50 text-red-600"
                            : "bg-ink/10 text-ink/50"
                        }`}
                      >
                        {c.status}
                      </span>
                    </div>
                    {c.config.endpoint ? (
                      <p className="mt-1 text-xs text-ink/40">
                        {c.config.endpoint}
                      </p>
                    ) : null}
                    {c.config.notes ? (
                      <p className="mt-1 text-sm text-ink/50">{c.config.notes}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
