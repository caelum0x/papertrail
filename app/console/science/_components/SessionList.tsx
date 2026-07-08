import Link from "next/link";
import type { ScienceSession } from "@/lib/science/clientTypes";

// A single session row plus the list that composes them.

function SessionRow({ session }: { session: ScienceSession }) {
  return (
    <li>
      <Link
        href={`/console/science/${session.id}`}
        className="block bg-white border border-ink/15 rounded-lg p-4 hover:border-accent"
      >
        <div className="flex items-center justify-between">
          <span className="font-medium text-ink/80">{session.title}</span>
          <span
            className={`text-xs rounded px-2 py-0.5 ${
              session.status === "active"
                ? "bg-accent/10 text-accent"
                : "bg-ink/10 text-ink/50"
            }`}
          >
            {session.status}
          </span>
        </div>
        <p className="mt-1 text-xs text-ink/40">
          Started {new Date(session.createdAt).toLocaleString()}
        </p>
      </Link>
    </li>
  );
}

export function SessionEmptyState() {
  return (
    <div className="bg-white border border-ink/15 rounded-lg p-8 text-center">
      <p className="text-sm text-ink/60">No research sessions yet.</p>
      <p className="mt-1 text-sm text-ink/40">
        Start a session to explore the literature with the assistant.
      </p>
    </div>
  );
}

export function SessionList({ sessions }: { sessions: ScienceSession[] }) {
  return (
    <ul className="space-y-2">
      {sessions.map((s) => (
        <SessionRow key={s.id} session={s} />
      ))}
    </ul>
  );
}
