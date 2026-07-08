"use client";

import { useState } from "react";
import Link from "next/link";
import ActivityFeed from "@/components/collaboration/ActivityFeed";
import type { CollabEntityType } from "@/components/collaboration/client";
import { ActivityFilters } from "./_components/ActivityFilters";

// The org-wide activity feed. A lightweight filter bar drives the reusable
// ActivityFeed component (which owns loading / empty / error / pagination).

export default function ActivityPage() {
  const [entityType, setEntityType] = useState<"" | CollabEntityType>("");
  const [verb, setVerb] = useState<string>("");

  return (
    <div>
      <div className="mb-4 flex items-center justify-end">
        <Link
          href="/console/activity/by-type"
          className="text-xs text-ink/60 hover:text-accent"
        >
          Browse by type →
        </Link>
      </div>

      <ActivityFilters
        entityType={entityType}
        verb={verb}
        onEntityChange={setEntityType}
        onVerbChange={setVerb}
      />

      <ActivityFeed
        entityType={entityType || undefined}
        verb={verb || undefined}
        limit={20}
      />
    </div>
  );
}
