import { NextResponse } from "next/server";

// Standard response envelope for all /api routes. Every route returns this
// shape so clients can rely on { success, data, error, meta } uniformly.
export interface ApiMeta {
  total?: number;
  page?: number;
  limit?: number;
}

export type ApiResponse<T> = {
  success: boolean;
  data: T | null;
  error: string | null;
  meta?: ApiMeta;
};

export function ok<T>(data: T, meta?: ApiMeta): NextResponse {
  const body: ApiResponse<T> = { success: true, data, error: null };
  if (meta) {
    body.meta = meta;
  }
  return NextResponse.json(body, { status: 200 });
}

export function created<T>(data: T): NextResponse {
  const body: ApiResponse<T> = { success: true, data, error: null };
  return NextResponse.json(body, { status: 201 });
}

export function fail(message: string, status: number): NextResponse {
  const body: ApiResponse<null> = { success: false, data: null, error: message };
  return NextResponse.json(body, { status });
}
