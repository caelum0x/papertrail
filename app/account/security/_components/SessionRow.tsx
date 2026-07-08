"use client";

import type { UserSession } from "@/lib/account/types";
import { Button } from "@/components/account/fields";

// Parses a raw user-agent into a short, human-readable device label. Best-effort:
// falls back to "Unknown device" so a missing / weird UA never renders blank.
function describeAgent(ua: string | null): string {
  if (!ua) return "Unknown device";
  const browser =
    /edg/i.test(ua) ? "Edge" :
    /chrome|crios/i.test(ua) ? "Chrome" :
    /firefox|fxios/i.test(ua) ? "Firefox" :
    /safari/i.test(ua) ? "Safari" :
    "Browser";
  const os =
    /windows/i.test(ua) ? "Windows" :
    /mac os|macintosh/i.test(ua) ? "macOS" :
    /iphone|ipad|ios/i.test(ua) ? "iOS" :
    /android/i.test(ua) ? "Android" :
    /linux/i.test(ua) ? "Linux" :
    "";
  return os ? `${browser} on ${os}` : browser;
}

function formatSeen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

interface SessionRowProps {
  session: UserSession;
  revoking: boolean;
  onRevoke: (id: string) => void;
}

export function SessionRow({ session, revoking, onRevoke }: SessionRowProps) {
  return (
    <li className="flex items-center justify-between gap-4 px-5 py-3">
      <div className="min-w-0">
        <p className="flex items-center gap-2 text-sm text-ink/80">
          <span className="truncate">{describeAgent(session.userAgent)}</span>
          {session.current ? (
            <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-green-700">
              This device
            </span>
          ) : null}
        </p>
        <p className="truncate text-xs text-ink/40">
          {session.ip ?? "Unknown IP"} · last seen {formatSeen(session.lastSeenAt)}
        </p>
      </div>
      <Button
        variant="danger"
        disabled={session.current || revoking}
        title={session.current ? "You can't revoke the session you're using." : undefined}
        onClick={() => onRevoke(session.id)}
      >
        {revoking ? "Revoking…" : "Revoke"}
      </Button>
    </li>
  );
}
