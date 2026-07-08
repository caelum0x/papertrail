"use client";

import { useCallback, useEffect, useState } from "react";
import { apiGet, type TeamDTO } from "./api";
import { TeamCard } from "./TeamCard";
import { CreateTeamCard } from "./CreateTeamCard";
import { EmptyState } from "./EmptyState";
import { Pagination } from "./Pagination";

const PAGE_SIZE = 20;

// LIST view for teams: a responsive grid of TeamCards with an inline
// CreateTeamCard, plus loading/empty/error states and pagination.
export function TeamsGrid() {
  const [teams, setTeams] = useState<TeamDTO[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (p: number) => {
    setLoading(true);
    setError(null);
    const res = await apiGet<TeamDTO[]>(`/api/teams?page=${p}&limit=${PAGE_SIZE}`);
    if (!res.success || !res.data) {
      setError(res.error ?? "Failed to load teams.");
      setLoading(false);
      return;
    }
    setTeams(res.data);
    setTotal(res.meta?.total ?? res.data.length);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load(page);
  }, [load, page]);

  const handleCreated = useCallback(() => {
    setPage(1);
    void load(1);
  }, [load]);

  if (loading) {
    return <div className="text-sm text-ink/40">Loading teams…</div>;
  }

  return (
    <div>
      {error ? (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {teams.length === 0 && !error ? (
        <div className="space-y-4">
          <EmptyState
            title="No teams yet"
            description="Group members into teams to organize collaboration and assign shared permissions."
          />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <CreateTeamCard onCreated={handleCreated} />
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {teams.map((team) => (
              <TeamCard key={team.id} team={team} />
            ))}
            <CreateTeamCard onCreated={handleCreated} />
          </div>
          <Pagination
            page={page}
            total={total}
            limit={PAGE_SIZE}
            onPageChange={setPage}
          />
        </>
      )}
    </div>
  );
}
