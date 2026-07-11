"use client";

// Client fetch helpers for the enterprise audit-export console. Attaches the
// active org id (persisted by the console layout) as x-org-id so withOrg scopes
// the call, and normalizes the response into an AssembleResult that distinguishes
// success, the 402 upgrade wall, and generic errors.

import type { AssembleResult, AuditExportView, UpgradeDetail } from "./types";

const ORG_STORAGE_KEY = "pt_active_org";

function orgHeaders(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const orgId = window.localStorage.getItem(ORG_STORAGE_KEY);
  return orgId ? { "x-org-id": orgId } : {};
}

// Build a query string from the optional window plus any extra params. Returns
// "" when there is nothing to add, otherwise a leading-"?" string.
function buildQuery(
  from: string,
  to: string,
  extra: Record<string, string> = {}
): string {
  const search = new URLSearchParams();
  if (from) search.set("from", from);
  if (to) search.set("to", to);
  for (const [k, v] of Object.entries(extra)) {
    search.set(k, v);
  }
  const s = search.toString();
  return s ? `?${s}` : "";
}

// A 402 body carries { error, upgrade: { feature, currentTier, requiredTiers } }.
function isUpgradeBody(
  body: unknown
): body is { error?: string; upgrade: UpgradeDetail } {
  if (body === null || typeof body !== "object") return false;
  const u = (body as { upgrade?: unknown }).upgrade;
  return (
    u !== null &&
    typeof u === "object" &&
    typeof (u as UpgradeDetail).feature === "string" &&
    typeof (u as UpgradeDetail).currentTier === "string" &&
    Array.isArray((u as UpgradeDetail).requiredTiers)
  );
}

// Assemble (preview) the export as JSON for on-screen review. Returns a
// discriminated result so the page can render the right state without inspecting
// raw HTTP status codes.
export async function assembleExport(
  from: string,
  to: string
): Promise<AssembleResult> {
  try {
    const res = await fetch(
      `/api/enterprise/audit-export${buildQuery(from, to)}`,
      { headers: { ...orgHeaders() }, cache: "no-store" }
    );
    const body = (await res.json().catch(() => null)) as unknown;

    if (res.status === 402 && isUpgradeBody(body)) {
      return {
        kind: "upgrade",
        detail: body.upgrade,
        message:
          body.error ??
          "Immutable audit export requires an Enterprise plan.",
      };
    }

    if (
      res.ok &&
      body !== null &&
      typeof body === "object" &&
      (body as { success?: boolean }).success === true &&
      (body as { data?: unknown }).data
    ) {
      return {
        kind: "ok",
        data: (body as { data: AuditExportView }).data,
      };
    }

    const message =
      body !== null &&
      typeof body === "object" &&
      typeof (body as { error?: unknown }).error === "string"
        ? (body as { error: string }).error
        : "Failed to assemble the audit export.";
    return { kind: "error", message };
  } catch {
    return {
      kind: "error",
      message: "Network error assembling the audit export.",
    };
  }
}

// Build the download URL for the JSON attachment. The browser navigates to it so
// the Content-Disposition attachment header takes effect. The x-org-id header
// cannot ride a plain navigation, so we rely on the server's default-org
// resolution; when the user has switched orgs we open it via fetch + blob to
// preserve the header.
export async function downloadExport(from: string, to: string): Promise<AssembleResult> {
  try {
    const res = await fetch(
      `/api/enterprise/audit-export${buildQuery(from, to, { format: "json" })}`,
      { headers: { ...orgHeaders() }, cache: "no-store" }
    );

    if (res.status === 402) {
      const body = (await res.json().catch(() => null)) as unknown;
      if (isUpgradeBody(body)) {
        return {
          kind: "upgrade",
          detail: body.upgrade,
          message:
            body.error ?? "Immutable audit export requires an Enterprise plan.",
        };
      }
      return { kind: "error", message: "Audit export requires an upgrade." };
    }

    if (!res.ok) {
      return { kind: "error", message: "Failed to download the audit export." };
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    const disposition = res.headers.get("Content-Disposition") ?? "";
    const match = disposition.match(/filename="([^"]+)"/);
    anchor.download = match?.[1] ?? "papertrail-audit-export.json";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);

    // The download itself is the result; return a lightweight ok with the parsed
    // body so the caller can also refresh the on-screen summary.
    const data = JSON.parse(await blob.text()) as AuditExportView;
    return { kind: "ok", data };
  } catch {
    return {
      kind: "error",
      message: "Network error downloading the audit export.",
    };
  }
}
