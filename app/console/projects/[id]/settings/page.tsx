"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { apiGet, apiSend } from "@/components/projects/api";
import type { Project, ProjectMember } from "@/components/projects/types";
import { ProjectDetailsForm } from "../../_components/ProjectDetailsForm";
import { MembersList } from "../../_components/MembersList";
import { AddMemberForm } from "../../_components/AddMemberForm";
import { DangerZone } from "../../_components/DangerZone";
import { NotFoundCard } from "../../_components/NotFoundCard";

export default function ProjectSettingsPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const router = useRouter();

  const [project, setProject] = useState<Project | null>(null);
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<Project["status"]>("active");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  const [memberUserId, setMemberUserId] = useState("");
  const [memberRole, setMemberRole] = useState<ProjectMember["role"]>("editor");
  const [memberErr, setMemberErr] = useState<string | null>(null);
  const [addingMember, setAddingMember] = useState(false);

  const [deleting, setDeleting] = useState(false);

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
    const p = projRes.data;
    setProject(p);
    setName(p.name);
    setDescription(p.description ?? "");
    setStatus(p.status);
    setMembers(memRes.success && memRes.data ? memRes.data : []);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const onSave = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!id) return;
      setSaving(true);
      setSaveMsg(null);
      setSaveErr(null);
      const res = await apiSend<Project>(`/api/projects/${id}`, "PATCH", {
        name: name.trim(),
        description: description.trim() || null,
        status,
      });
      setSaving(false);
      if (!res.success || !res.data) {
        setSaveErr(res.error ?? "Failed to save.");
        return;
      }
      setProject(res.data);
      setSaveMsg("Saved.");
    },
    [id, name, description, status]
  );

  const onAddMember = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!id) return;
      if (!memberUserId.trim()) {
        setMemberErr("A user id is required.");
        return;
      }
      setAddingMember(true);
      setMemberErr(null);
      const res = await apiSend<ProjectMember>(
        `/api/projects/${id}/members`,
        "POST",
        { userId: memberUserId.trim(), role: memberRole }
      );
      setAddingMember(false);
      if (!res.success) {
        setMemberErr(res.error ?? "Failed to add member.");
        return;
      }
      setMemberUserId("");
      setMemberRole("editor");
      void load();
    },
    [id, memberUserId, memberRole, load]
  );

  const onDelete = useCallback(async () => {
    if (!id) return;
    if (
      typeof window !== "undefined" &&
      !window.confirm("Delete this project? This cannot be undone.")
    ) {
      return;
    }
    setDeleting(true);
    const res = await apiSend<{ id: string }>(`/api/projects/${id}`, "DELETE");
    setDeleting(false);
    if (!res.success) {
      setSaveErr(res.error ?? "Failed to delete project.");
      return;
    }
    router.replace("/console/projects");
  }, [id, router]);

  if (loading) {
    return <p className="text-sm text-ink/40">Loading settings...</p>;
  }

  if (error || !project) {
    return <NotFoundCard message={error ?? "Project not found."} />;
  }

  return (
    <div className="max-w-2xl">
      <Link
        href={`/console/projects/${project.id}`}
        className="text-sm text-ink/40 hover:text-ink/60"
      >
        ← {project.name}
      </Link>
      <h1 className="mt-1 text-2xl font-semibold text-ink/80">Project settings</h1>

      <ProjectDetailsForm
        name={name}
        description={description}
        status={status}
        saving={saving}
        message={saveMsg}
        error={saveErr}
        onNameChange={setName}
        onDescriptionChange={setDescription}
        onStatusChange={setStatus}
        onSubmit={onSave}
      />

      <div className="mt-6 bg-white border border-ink/15 rounded-lg p-5">
        <h2 className="text-sm font-medium text-ink/70">Members</h2>
        {members.length === 0 ? (
          <p className="mt-2 text-sm text-ink/40">No members yet.</p>
        ) : (
          <MembersList members={members} showEmail />
        )}

        <AddMemberForm
          userId={memberUserId}
          role={memberRole}
          adding={addingMember}
          error={memberErr}
          onUserIdChange={setMemberUserId}
          onRoleChange={setMemberRole}
          onSubmit={onAddMember}
        />
      </div>

      <DangerZone deleting={deleting} onDelete={onDelete} />
    </div>
  );
}
