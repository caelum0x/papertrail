import Link from "next/link";
import type { Project } from "@/components/projects/types";
import { ProjectStatusBadge } from "./ProjectStatusBadge";

// Renders the list of project cards. Each row links to the project dashboard.

function ProjectRow({ project }: { project: Project }) {
  return (
    <li>
      <Link
        href={`/console/projects/${project.id}`}
        className="block bg-white border border-ink/15 rounded-lg p-4 hover:border-accent"
      >
        <div className="flex items-center justify-between">
          <span className="font-medium text-ink/80">{project.name}</span>
          <ProjectStatusBadge status={project.status} />
        </div>
        {project.description ? (
          <p className="mt-1 text-sm text-ink/40 line-clamp-2">
            {project.description}
          </p>
        ) : null}
      </Link>
    </li>
  );
}

export function ProjectList({ projects }: { projects: Project[] }) {
  return (
    <ul className="space-y-2">
      {projects.map((p) => (
        <ProjectRow key={p.id} project={p} />
      ))}
    </ul>
  );
}
