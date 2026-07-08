"use client";

import { useState } from "react";
import Link from "next/link";
import ActivityFeed from "@/components/collaboration/ActivityFeed";
import type { CollabEntityType } from "@/components/collaboration/client";
import { entityLabel } from "../_components/filters";
import { VERB_FILTERS } from "../_components/filters";
import { FilterChips } from "../_components/FilterChips";

const ENTITIES: CollabEntityType[] = [
  "claim",
  "document",
  "verification",
  "review",
];

// Entity-scoped view of the activity feed: pick a single entity type, then
// optionally narrow by verb. Built on the existing ActivityFeed / activity API.
export default function ActivityByTypePage() {
  const [entity, setEntity] = useState<CollabEntityType>("claim");
  const [verb, setVerb] = useState<string>("");

  return (
    <div>
      <Link
        href="/console/activity"
        className="text-sm text-accent hover:underline"
      >
        ← Back to activity
      </Link>

      <h1 className="mt-2 text-2xl font-semibold text-ink/80">Activity by type</h1>
      <p className="mt-1 text-sm text-ink/40">
        Focus on a single entity type and drill into its collaboration history.
      </p>

      <div className="mt-4 inline-flex rounded-lg border border-ink/10 bg-white p-0.5">
        {ENTITIES.map((e) => (
          <button
            key={e}
            onClick={() => setEntity(e)}
            className={`rounded-md px-3 py-1.5 text-sm ${
              entity === e
                ? "bg-paper text-accent font-medium"
                : "text-ink/60 hover:text-ink/80"
            }`}
          >
            {entityLabel(e)}
          </button>
        ))}
      </div>

      <div className="mt-3">
        <FilterChips
          options={VERB_FILTERS}
          value={verb}
          onChange={setVerb}
          keyPrefix="all-verbs"
        />
      </div>

      <div className="mt-4">
        <ActivityFeed
          entityType={entity}
          verb={verb || undefined}
          limit={20}
        />
      </div>
    </div>
  );
}
