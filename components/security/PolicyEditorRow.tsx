"use client";

import { useState } from "react";
import type { SecurityPolicy } from "@/lib/security/types";
import { POLICY_KIND_META } from "@/lib/security/types";
import { Toggle } from "./Toggle";
import { PolicyConfigFields } from "./PolicyConfigFields";

// One editable row in the policy editor: title, description, an enable/disable
// switch, and (for kinds with config) an inline config form with an explicit
// Save button. Local draft state lets the user edit config without persisting
// on every keystroke; saving is delegated to the parent.

interface PolicyEditorRowProps {
  policy: SecurityPolicy;
  saving?: boolean;
  onToggle: (kind: SecurityPolicy["kind"], next: boolean) => void;
  onSaveConfig: (
    kind: SecurityPolicy["kind"],
    config: Record<string, unknown>
  ) => void;
}

const KINDS_WITH_CONFIG = new Set(["session_timeout", "data_residency"]);

export function PolicyEditorRow({
  policy,
  saving,
  onToggle,
  onSaveConfig,
}: PolicyEditorRowProps) {
  const meta = POLICY_KIND_META[policy.kind];
  const [draftConfig, setDraftConfig] = useState<Record<string, unknown>>(
    policy.config
  );
  const [dirty, setDirty] = useState(false);

  const hasConfig = KINDS_WITH_CONFIG.has(policy.kind);

  return (
    <div className="bg-white border border-ink/15 rounded-lg p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-ink/80">{meta.label}</h3>
          <p className="mt-1 text-sm text-ink/50">{meta.description}</p>
        </div>
        <Toggle
          checked={policy.enabled}
          disabled={saving}
          onChange={(next) => onToggle(policy.kind, next)}
          label={`Toggle ${meta.label}`}
        />
      </div>

      {hasConfig ? (
        <div className="mt-1 border-t border-ink/10 pt-1">
          <PolicyConfigFields
            kind={policy.kind}
            config={draftConfig}
            disabled={saving}
            onChange={(next) => {
              setDraftConfig(next);
              setDirty(true);
            }}
          />
          {dirty ? (
            <div className="mt-3 flex justify-end gap-3">
              <button
                type="button"
                disabled={saving}
                onClick={() => {
                  setDraftConfig(policy.config);
                  setDirty(false);
                }}
                className="text-sm text-ink/50 hover:underline disabled:opacity-50"
              >
                Reset
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => {
                  onSaveConfig(policy.kind, draftConfig);
                  setDirty(false);
                }}
                className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
