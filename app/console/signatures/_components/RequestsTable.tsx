"use client";

import type { SignatureRequest } from "@/lib/signatures/types";
import { RequestRow } from "./RequestRow";

// Table of signature requests. Presentational — the parent owns loading/empty/
// error states and only renders this when there are rows.
export function RequestsTable({ items }: { items: SignatureRequest[] }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs uppercase tracking-wide text-ink/40">
          <th className="px-4 py-2 font-medium">Title</th>
          <th className="px-4 py-2 font-medium">Entity</th>
          <th className="px-4 py-2 font-medium">Status</th>
          <th className="px-4 py-2 text-right font-medium">Created</th>
        </tr>
      </thead>
      <tbody>
        {items.map((request) => (
          <RequestRow key={request.id} request={request} />
        ))}
      </tbody>
    </table>
  );
}
