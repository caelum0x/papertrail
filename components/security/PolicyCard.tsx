"use client";

import type { SecurityPolicy } from "@/lib/security/types";
import { POLICY_KIND_META } from "@/lib/security/types";
import { Toggle } from "./Toggle";

// A single security control rendered as a card with a title, description, and an
// enable/disable switch. Toggling is delegated to the parent via onToggle;
// `saving` disables the switch while a request is in flight.

interface PolicyCardProps {
  policy: SecurityPolicy;
  saving?: boolean;
  onToggle: (kind: SecurityPolicy["kind"], next: boolean) => void;
}

export function PolicyCard({ policy, saving, onToggle }: PolicyCardProps) {
  const meta = POLICY_KIND_META[policy.kind];

  return (
    <div className="bg-white border border-ink/15 rounded-lg p-4 flex items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium text-ink/80">{meta.label}</h3>
          <span
            className={[
              "rounded px-1.5 py-0.5 text-xs",
              policy.enabled
                ? "border border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border border-ink/10 bg-paper text-ink/50",
            ].join(" ")}
          >
            {policy.enabled ? "On" : "Off"}
          </span>
        </div>
        <p className="mt-1 text-sm text-ink/50">{meta.description}</p>
      </div>
      <Toggle
        checked={policy.enabled}
        disabled={saving}
        onChange={(next) => onToggle(policy.kind, next)}
        label={`Toggle ${meta.label}`}
      />
    </div>
  );
}
