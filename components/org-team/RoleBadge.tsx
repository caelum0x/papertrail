interface RoleBadgeProps {
  role: string;
}

const STYLES: Record<string, string> = {
  owner: "bg-accent/10 text-accent",
  admin: "bg-ink/10 text-ink/80",
  editor: "bg-ink/5 text-ink/70",
  viewer: "bg-ink/5 text-ink/60",
};

export function RoleBadge({ role }: RoleBadgeProps) {
  const cls = STYLES[role] ?? "bg-ink/5 text-ink/60";
  return (
    <span
      className={`inline-block rounded px-2 py-0.5 text-xs font-medium capitalize ${cls}`}
    >
      {role}
    </span>
  );
}
