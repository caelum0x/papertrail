"use client";

import Link from "next/link";
import type { TeamDTO } from "./api";

// A single team tile in the TeamsGrid.
export function TeamCard({ team }: { team: TeamDTO }) {
  return (
    <Link
      href={`/console/teams/${team.id}`}
      className="block rounded-lg border border-ink/10 bg-white p-4 transition hover:border-accent/40 hover:shadow-sm"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-medium text-ink/80">{team.name}</h3>
        <span className="shrink-0 rounded-full bg-paper px-2 py-0.5 text-xs text-ink/50">
          {team.memberCount} {team.memberCount === 1 ? "member" : "members"}
        </span>
      </div>
      <p className="mt-2 line-clamp-2 text-sm text-ink/40">
        {team.description || "No description."}
      </p>
    </Link>
  );
}
