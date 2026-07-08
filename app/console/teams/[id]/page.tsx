"use client";

import { useParams } from "next/navigation";
import { TeamDetail } from "@/components/rbac/TeamDetail";

// DETAIL view: team header + add-member form + members table.
export default function TeamDetailPage() {
  const params = useParams<{ id: string }>();
  const teamId = params?.id;

  return (
    <div className="max-w-4xl">
      {teamId ? (
        <TeamDetail teamId={teamId} />
      ) : (
        <div className="text-sm text-red-600">Invalid team id.</div>
      )}
    </div>
  );
}
