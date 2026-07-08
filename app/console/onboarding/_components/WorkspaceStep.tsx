"use client";

import Link from "next/link";
import { StepShell } from "./StepShell";
import type { SessionOrg } from "./useSession";

// Second wizard step. Confirms the active workspace (org) the user's claims live
// in. The org already exists (created at signup), so this is a confirmation step
// with a pointer to Settings for renaming; continuing marks it complete.

interface WorkspaceStepProps {
  activeOrg: SessionOrg | null;
  onBack: () => void;
  onContinue: () => void;
  busy: boolean;
  error: string | null;
}

export function WorkspaceStep({
  activeOrg,
  onBack,
  onContinue,
  busy,
  error,
}: WorkspaceStepProps) {
  return (
    <StepShell
      title="Name your workspace"
      blurb="This is the organization your claims, sources, and reports live in."
      onBack={onBack}
      primaryLabel="Continue"
      onPrimary={onContinue}
      primaryDisabled={!activeOrg}
      primaryBusy={busy}
      error={error}
    >
      {activeOrg ? (
        <div className="rounded border border-ink/10 bg-paper p-4">
          <p className="text-sm font-medium text-ink/80">{activeOrg.name}</p>
          <p className="mt-0.5 text-xs text-ink/60">
            /{activeOrg.slug} &middot; you are {activeOrg.role}
          </p>
          <p className="mt-3 text-sm text-ink/60">
            You can rename this workspace or adjust defaults anytime in{" "}
            <Link
              href="/console/settings"
              className="text-accent hover:underline"
            >
              Settings
            </Link>
            .
          </p>
        </div>
      ) : (
        <p className="text-sm text-ink/60">
          No organization found for your account. Contact support if this seems
          wrong.
        </p>
      )}
    </StepShell>
  );
}
