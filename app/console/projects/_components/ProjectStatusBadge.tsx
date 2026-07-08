import type { ProjectStatus } from "@/components/projects/types";

// Small colored pill for a project's lifecycle status. Pure presentational.

export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  return (
    <span
      className={`inline-block text-xs rounded px-2 py-0.5 ${
        status === "active"
          ? "bg-accent/10 text-accent"
          : "bg-ink/10 text-ink/50"
      }`}
    >
      {status}
    </span>
  );
}
