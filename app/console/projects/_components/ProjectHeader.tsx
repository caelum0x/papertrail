import Link from "next/link";
import type { ReactNode } from "react";
import type { Project } from "@/components/projects/types";
import { ProjectStatusBadge } from "./ProjectStatusBadge";

// Header for a single project: a back link, the project name, its status badge,
// and an optional action slot (e.g. a Settings link).

interface ProjectHeaderProps {
  project: Project;
  action?: ReactNode;
}

export function ProjectHeader({ project, action }: ProjectHeaderProps) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <Link
          href="/console/projects"
          className="text-sm text-ink/40 hover:text-ink/60"
        >
          ← Projects
        </Link>
        <h1 className="mt-1 text-2xl font-semibold text-ink/80">
          {project.name}
        </h1>
        <span className="mt-1 inline-block">
          <ProjectStatusBadge status={project.status} />
        </span>
      </div>
      {action ?? null}
    </div>
  );
}
