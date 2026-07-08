import Link from "next/link";

interface NotificationsHeaderProps {
  title: string;
  subtitle: string;
  // Optional inline controls (unread toggle, mark-all) rendered on the right.
  children?: React.ReactNode;
  // Optional right-aligned link (e.g. back link on the preferences sub-page).
  link?: { href: string; label: string };
}

// Header row for the notifications module: title + description on the left,
// optional controls or a back link on the right.
export function NotificationsHeader({
  title,
  subtitle,
  children,
  link,
}: NotificationsHeaderProps) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <h1 className="text-2xl font-semibold text-ink/80">{title}</h1>
        <p className="mt-1 text-sm text-ink/40">{subtitle}</p>
      </div>
      {children ? (
        <div className="flex items-center gap-3">{children}</div>
      ) : link ? (
        <Link href={link.href} className="text-sm text-ink/60 hover:text-accent">
          {link.label}
        </Link>
      ) : null}
    </div>
  );
}
