"use client";

import Link from "next/link";
import type { SignatureRequest } from "@/lib/signatures/types";
import {
  RequestStatusBadge,
  EntityChip,
  relativeTime,
} from "@/components/signatures/ui";

// A single row in the requests table, linking to the request detail page.
export function RequestRow({ request }: { request: SignatureRequest }) {
  return (
    <tr className="border-t border-ink/10 hover:bg-paper/50">
      <td className="px-4 py-3">
        <Link
          href={`/console/signatures/${request.id}`}
          className="font-medium text-accent hover:underline"
        >
          {request.title}
        </Link>
      </td>
      <td className="px-4 py-3">
        <EntityChip
          entityType={request.entityType}
          entityId={request.entityId}
        />
      </td>
      <td className="px-4 py-3">
        <RequestStatusBadge status={request.status} />
      </td>
      <td className="px-4 py-3 text-right text-xs text-ink/40">
        {relativeTime(request.createdAt)}
      </td>
    </tr>
  );
}
