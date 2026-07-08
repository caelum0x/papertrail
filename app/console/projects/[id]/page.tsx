"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { apiGet } from "@/components/projects/api";
import type { Project, ProjectMember } from "@/components/projects/types";
import { ProjectHeader } from "../_components/ProjectHeader";
import { MembersCard } from "../_components/MembersCard";
import { QuickLinks } from "../_components/QuickLinks";
import { NotFoundCard } from "../_components/NotFoundCard";

export default function ProjectDashboardPage() {
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
    return <p className="text-sm text-ink/40">Loading project...</p>;
  }

  if (error || !project) {
    return <NotFoundCard message={error ?? "Project not found."} />;
  }

  return (
    <div>
      <ProjectHeader
        project={project}
        action={
          <Link
            href={`/console/projects/${project.id}/settings`}
            className="text-sm border border-ink/15 rounded px-3 py-2 text-ink/70 hover:border-accent"
          >
            Settings
          </Link>
        }
      />

      {project.description ? (
        <p className="mt-4 text-sm text-ink/60 max-w-2xl">
          {project.description}
        </p>
      ) : (
        <p className="mt-4 text-sm text-ink/35">No description.</p>
      )}

      <MembersCard projectId={project.id} members={members} />

      <QuickLinks />
    </div>
  );
}
