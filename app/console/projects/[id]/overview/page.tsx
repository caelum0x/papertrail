"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { apiGet } from "@/components/projects/api";
import type { Project, ProjectMember } from "@/components/projects/types";
import { ProjectHeader } from "../../_components/ProjectHeader";
import { MembersList } from "../../_components/MembersList";
import { NotFoundCard } from "../../_components/NotFoundCard";

// Read-only overview of a project: high-level stats plus a member roster.
// Uses only the existing project + members endpoints.
export default function ProjectOverviewPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const [project, setProject] = useState<Project | null>(null);
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    const [projRes, memRes] = await Promise.all([
      apiGet<Project>(`/api/projects/${id}`),
      apiGet<ProjectMember[]>(`/api/projects/${id}/members`),
    ]);
    if (!projRes.success || !projRes.data) {
      setError(projRes.error ?? "Failed to load project.");
      setLoading(false);
      return;
    }
    setProject(projRes.data);
    setMembers(memRes.success && memRes.data ? memRes.data : []);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return <p className="text-sm text-ink/40">Loading overview...</p>;
  }

  if (error || !project) {
    return <NotFoundCard message={error ?? "Project not found."} />;
  }

  const owners = members.filter((m) => m.role === "owner").length;
  const stats: { label: string; value: string }[] = [
    { label: "Status", value: project.status },
    { label: "Members", value: String(members.length) },
    { label: "Owners", value: String(owners) },
  ];

  return (
    <div>
      <ProjectHeader
        project={project}
        action={
          <Link
            href={`/console/projects/${project.id}`}
            className="text-sm border border-ink/15 rounded px-3 py-2 text-ink/70 hover:border-accent"
          >
            Dashboard
          </Link>
        }
      />

      <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-4">
        {stats.map((s) => (
          <div
            key={s.label}
            className="bg-white border border-ink/15 rounded-lg p-4"
          >
            <div className="text-xs text-ink/40">{s.label}</div>
            <div className="mt-1 text-lg font-semibold text-ink/80 capitalize">
              {s.value}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 bg-white border border-ink/15 rounded-lg p-5">
        <h2 className="text-sm font-medium text-ink/70">Description</h2>
        {project.description ? (
          <p className="mt-2 text-sm text-ink/60">{project.description}</p>
        ) : (
          <p className="mt-2 text-sm text-ink/35">No description.</p>
        )}
      </div>

      <div className="mt-6 bg-white border border-ink/15 rounded-lg p-5">
        <h2 className="text-sm font-medium text-ink/70">
          Members <span className="text-ink/35">({members.length})</span>
        </h2>
        {members.length === 0 ? (
          <p className="mt-2 text-sm text-ink/40">No members yet.</p>
        ) : (
          <MembersList members={members} showEmail />
        )}
      </div>
    </div>
  );
}
