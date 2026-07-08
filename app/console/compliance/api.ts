import type {
  Signature,
  SignatureMeaning,
  AuditChainEntry,
  RetentionPolicy,
  ChainVerification,
} from "@/lib/compliance/types";

// Client-side fetch helpers for the Compliance console. Each unwraps the standard
// { success, data, error, meta } envelope and throws a user-facing Error on
// failure so pages can surface it in their error state.

interface ApiEnvelope<T> {
  success: boolean;
  data: T | null;
  error: string | null;
  meta?: { total?: number; page?: number; limit?: number };
}

async function unwrap<T>(res: Response): Promise<{ data: T; total: number }> {
  let body: ApiEnvelope<T> | null = null;
  try {
    body = (await res.json()) as ApiEnvelope<T>;
  } catch {
    body = null;
  }
  if (!res.ok || !body || !body.success || body.data === null) {
    throw new Error(body?.error ?? "Something went wrong. Please try again.");
  }
  return { data: body.data, total: body.meta?.total ?? 0 };
}

function qs(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") {
      search.set(key, String(value));
    }
  }
  const s = search.toString();
  return s ? `?${s}` : "";
}

export interface ListResult<T> {
  items: T[];
  total: number;
}

// ---------- audit chain ----------

export async function fetchChainEntries(params: {
  page?: number;
  limit?: number;
}): Promise<ListResult<AuditChainEntry>> {
  const res = await fetch(`/api/audit-chain${qs(params)}`, {
    headers: { Accept: "application/json" },
  });
  const { data, total } = await unwrap<AuditChainEntry[]>(res);
  return { items: data, total };
}

export async function verifyChain(): Promise<ChainVerification> {
  const res = await fetch(`/api/audit-chain/verify`, {
    headers: { Accept: "application/json" },
  });
  const { data } = await unwrap<ChainVerification>(res);
  return data;
}

// ---------- retention policies ----------

export async function fetchRetentionPolicies(): Promise<RetentionPolicy[]> {
  const res = await fetch(`/api/retention-policies`, {
    headers: { Accept: "application/json" },
  });
  const { data } = await unwrap<RetentionPolicy[]>(res);
  return data;
}

export interface UpsertRetentionPayload {
  entityType: string;
  retainDays: number;
}

export async function upsertRetentionPolicy(
  payload: UpsertRetentionPayload
): Promise<RetentionPolicy> {
  const res = await fetch(`/api/retention-policies`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const { data } = await unwrap<RetentionPolicy>(res);
  return data;
}

// ---------- signatures ----------

export async function fetchSignatures(params: {
  entityType?: string;
  entityId?: string;
  page?: number;
  limit?: number;
}): Promise<ListResult<Signature>> {
  const res = await fetch(
    `/api/signatures${qs({
      entityType: params.entityType || undefined,
      entityId: params.entityId || undefined,
      page: params.page,
      limit: params.limit,
    })}`,
    { headers: { Accept: "application/json" } }
  );
  const { data, total } = await unwrap<Signature[]>(res);
  return { items: data, total };
}

export interface CreateSignaturePayload {
  entityType: string;
  entityId: string;
  meaning: SignatureMeaning;
}

export async function createSignature(
  payload: CreateSignaturePayload
): Promise<Signature> {
  const res = await fetch(`/api/signatures`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const { data } = await unwrap<Signature>(res);
  return data;
}
