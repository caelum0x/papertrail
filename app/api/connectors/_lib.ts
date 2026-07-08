import { fail } from "@/lib/api/response";
import { z } from "zod";

// Shared helpers for the connectors API routes: map an RBAC error to its status
// and validate a route [id] param. Kept in a leaf file so route modules stay thin
// and consistent.

export const idSchema = z.string().uuid();

export function rbacStatus(err: unknown): number | null {
  if (
    err instanceof Error &&
    typeof (err as unknown as { status?: unknown }).status === "number"
  ) {
    return (err as unknown as { status: number }).status;
  }
  return null;
}

// Maps a caught error to a NextResponse: RBAC errors keep their status, anything
// else becomes a 500 with the given user-facing message.
export function failFromError(err: unknown, fallback: string) {
  const status = rbacStatus(err);
  if (status !== null) {
    return fail((err as Error).message, status);
  }
  return fail(fallback, 500);
}
