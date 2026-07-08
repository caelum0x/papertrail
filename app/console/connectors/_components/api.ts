"use client";

// Client-side fetch helpers for the connectors console pages. Attaches the active
// org id (persisted by the console layout under the shared key) as the x-org-id
// header so withOrg scopes calls to the shown org, and unwraps the
// { success, data, error, meta } envelope into a small result shape.

import type { ApiResponse } from "@/lib/api/response";
import type {
  Connector,
  ConnectorActionResult,
  ConnectorEvent,
  ConnectorSync,
} from "@/lib/connectors/types";
import type { CatalogEntryView } from "./types";

const ORG_STORAGE_KEY = "pt_active_org";

function orgHeaders(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const orgId = window.localStorage.getItem(ORG_STORAGE_KEY);
  return orgId ? { "x-org-id": orgId } : {};
}

export interface FetchResult<T> {
  data: T | null;
  error: string | null;
  total: number;
}

async function readEnvelope<T>(
  res: Response,
  fallback: string
): Promise<FetchResult<T>> {
  const body = (await res.json().catch(() => null)) as ApiResponse<T> | null;
  if (!body) {
    return { data: null, error: fallback, total: 0 };
  }
  if (!res.ok || !body.success) {
    return { data: null, error: body.error ?? fallback, total: 0 };
  }
  return { data: body.data ?? null, error: null, total: body.meta?.total ?? 0 };
}

function qs(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") search.set(k, v);
  }
  const s = search.toString();
  return s ? `?${s}` : "";
}

// --- Catalog ---------------------------------------------------------------

export async function fetchCatalog(): Promise<FetchResult<CatalogEntryView[]>> {
  try {
    const res = await fetch("/api/connectors/catalog", {
      headers: { ...orgHeaders() },
      cache: "no-store",
    });
    return await readEnvelope<CatalogEntryView[]>(res, "Failed to load catalog.");
  } catch {
    return { data: null, error: "Network error loading catalog.", total: 0 };
  }
}

// --- Connectors ------------------------------------------------------------

export async function fetchConnectors(
  page: number,
  limit: number,
  filters: { provider?: string; status?: string }
): Promise<FetchResult<Connector[]>> {
  try {
    const res = await fetch(
      `/api/connectors${qs({
        page: String(page),
        limit: String(limit),
        provider: filters.provider,
        status: filters.status,
      })}`,
      { headers: { ...orgHeaders() }, cache: "no-store" }
    );
    return await readEnvelope<Connector[]>(res, "Failed to load connectors.");
  } catch {
    return { data: null, error: "Network error loading connectors.", total: 0 };
  }
}

export async function fetchConnector(
  id: string
): Promise<FetchResult<Connector>> {
  try {
    const res = await fetch(`/api/connectors/${id}`, {
      headers: { ...orgHeaders() },
      cache: "no-store",
    });
    return await readEnvelope<Connector>(res, "Failed to load connector.");
  } catch {
    return { data: null, error: "Network error loading connector.", total: 0 };
  }
}

export interface CreateConnectorInput {
  provider: string;
  name: string;
  config: Record<string, unknown>;
}

export async function createConnector(
  input: CreateConnectorInput
): Promise<FetchResult<Connector>> {
  try {
    const res = await fetch("/api/connectors", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...orgHeaders() },
      body: JSON.stringify(input),
    });
    return await readEnvelope<Connector>(res, "Failed to create connector.");
  } catch {
    return { data: null, error: "Network error creating connector.", total: 0 };
  }
}

export async function updateConnector(
  id: string,
  input: {
    name?: string;
    config?: Record<string, unknown>;
    status?: string;
  }
): Promise<FetchResult<Connector>> {
  try {
    const res = await fetch(`/api/connectors/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...orgHeaders() },
      body: JSON.stringify(input),
    });
    return await readEnvelope<Connector>(res, "Failed to update connector.");
  } catch {
    return { data: null, error: "Network error updating connector.", total: 0 };
  }
}

export async function deleteConnector(
  id: string
): Promise<FetchResult<{ id: string; deleted: boolean }>> {
  try {
    const res = await fetch(`/api/connectors/${id}`, {
      method: "DELETE",
      headers: { ...orgHeaders() },
    });
    return await readEnvelope<{ id: string; deleted: boolean }>(
      res,
      "Failed to delete connector."
    );
  } catch {
    return { data: null, error: "Network error deleting connector.", total: 0 };
  }
}

// --- Lifecycle actions -----------------------------------------------------

export async function connectConnector(
  id: string
): Promise<FetchResult<ConnectorActionResult>> {
  try {
    const res = await fetch(`/api/connectors/${id}/connect`, {
      method: "POST",
      headers: { ...orgHeaders() },
    });
    return await readEnvelope<ConnectorActionResult>(res, "Failed to connect.");
  } catch {
    return { data: null, error: "Network error connecting.", total: 0 };
  }
}

export async function syncConnector(
  id: string
): Promise<FetchResult<ConnectorSync>> {
  try {
    const res = await fetch(`/api/connectors/${id}/sync`, {
      method: "POST",
      headers: { ...orgHeaders() },
    });
    return await readEnvelope<ConnectorSync>(res, "Failed to run sync.");
  } catch {
    return { data: null, error: "Network error running sync.", total: 0 };
  }
}

export async function testConnector(
  id: string,
  event?: string
): Promise<FetchResult<ConnectorActionResult>> {
  try {
    const res = await fetch(`/api/connectors/${id}/test`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...orgHeaders() },
      body: JSON.stringify(event ? { event } : {}),
    });
    return await readEnvelope<ConnectorActionResult>(
      res,
      "Failed to send test event."
    );
  } catch {
    return { data: null, error: "Network error sending test event.", total: 0 };
  }
}

// --- Syncs / events --------------------------------------------------------

export async function fetchSyncs(
  id: string,
  page: number,
  limit: number,
  status?: string
): Promise<FetchResult<ConnectorSync[]>> {
  try {
    const res = await fetch(
      `/api/connectors/${id}/syncs${qs({
        page: String(page),
        limit: String(limit),
        status,
      })}`,
      { headers: { ...orgHeaders() }, cache: "no-store" }
    );
    return await readEnvelope<ConnectorSync[]>(res, "Failed to load syncs.");
  } catch {
    return { data: null, error: "Network error loading syncs.", total: 0 };
  }
}

export async function fetchEvents(
  id: string,
  page: number,
  limit: number,
  direction?: string
): Promise<FetchResult<ConnectorEvent[]>> {
  try {
    const res = await fetch(
      `/api/connectors/${id}/events${qs({
        page: String(page),
        limit: String(limit),
        direction,
      })}`,
      { headers: { ...orgHeaders() }, cache: "no-store" }
    );
    return await readEnvelope<ConnectorEvent[]>(res, "Failed to load events.");
  } catch {
    return { data: null, error: "Network error loading events.", total: 0 };
  }
}
