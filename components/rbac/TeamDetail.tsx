"use client";

import { useCallback, useEffect, useState } from "react";
import {
  apiGet,
  type AssignableMemberDTO,
  type TeamDTO,
  type TeamMemberDTO,
} from "./api";
import { TeamHeader } from "./TeamHeader";
import { MembersTable } from "./MembersTable";
import { AddMemberForm } from "./AddMemberForm";

interface MembersPayload {
  members: TeamMemberDTO[];
  assignable: AssignableMemberDTO[];
}

// DETAIL view orchestrator: loads the team and its membership, then composes
// the header, add-member form, and members table. Owns shared state so any
// mutation refreshes the whole panel.
export function TeamDetail({ teamId }: { teamId: string }) {
  const [team, setTeam] = useState<TeamDTO | null>(null);
  const [members, setMembers] = useState<TeamMemberDTO[]>([]);
  const [assignable, setAssignable] = useState<AssignableMemberDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadTeam = useCallback(async () => {
    const res = await apiGet<TeamDTO>(`/api/teams/${teamId}`);
    if (res.success && res.data) {
      setTeam(res.data);
    }
  }, [teamId]);

  const loadMembers = useCallback(async () => {
    const res = await apiGet<MembersPayload>(`/api/teams/${teamId}/members`);
    if (res.success && res.data) {
      setMembers(res.data.members);
      setAssignable(res.data.assignable);
    }
  }, [teamId]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await apiGet<TeamDTO>(`/api/teams/${teamId}`);
    if (!res.success || !res.data) {
      setError(res.error ?? "Team not found.");
      setLoading(false);
      return;
    }
    setTeam(res.data);
    await loadMembers();
    setLoading(false);
  }, [loadMembers, teamId]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const handleMembersChanged = useCallback(async () => {
    await Promise.all([loadTeam(), loadMembers()]);
  }, [loadMembers, loadTeam]);

  if (loading) {
    return <div className="text-sm text-ink/40">Loading team…</div>;
  }
  if (error || !team) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
        {error ?? "Team not found."}
      </div>
    );
  }

  return (
    <div>
      <TeamHeader team={team} onUpdated={setTeam} />

      <section className="mb-6 rounded-lg border border-ink/10 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-ink/70">Add a member</h2>
        <AddMemberForm
          teamId={teamId}
          assignable={assignable}
          onAdded={handleMembersChanged}
        />
      </section>

      <MembersTable
        teamId={teamId}
        members={members}
        onChanged={handleMembersChanged}
      />
    </div>
  );
}
