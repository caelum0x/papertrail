"use client";

import type { SecurityPolicyKind } from "@/lib/security/types";

// Per-kind config fields for the policy editor. Only some controls carry extra
// configuration; kinds without config render nothing. Values are stringly-typed
// here and coerced by the parent before sending, since config is opaque jsonb.

interface PolicyConfigFieldsProps {
  kind: SecurityPolicyKind;
  config: Record<string, unknown>;
  disabled?: boolean;
  onChange: (next: Record<string, unknown>) => void;
}

const RESIDENCY_REGIONS = [
  { value: "us", label: "United States" },
  { value: "eu", label: "European Union" },
  { value: "apac", label: "Asia Pacific" },
] as const;

export function PolicyConfigFields({
  kind,
  config,
  disabled,
  onChange,
}: PolicyConfigFieldsProps) {
  if (kind === "session_timeout") {
    const minutes =
      typeof config.minutes === "number" ? config.minutes : 30;
    return (
      <label className="mt-3 block">
        <span className="text-xs text-ink/60">Timeout (minutes)</span>
        <input
          type="number"
          min={5}
          max={1440}
          value={minutes}
          disabled={disabled}
          onChange={(e) =>
            onChange({ ...config, minutes: Number(e.target.value) })
          }
          className="mt-1 w-32 rounded border border-ink/15 px-2 py-1.5 text-sm focus:outline-none focus:border-accent disabled:opacity-50"
        />
      </label>
    );
  }

  if (kind === "data_residency") {
    const region =
      typeof config.region === "string" ? config.region : "us";
    return (
      <label className="mt-3 block">
        <span className="text-xs text-ink/60">Region</span>
        <select
          value={region}
          disabled={disabled}
          onChange={(e) => onChange({ ...config, region: e.target.value })}
          className="mt-1 w-48 rounded border border-ink/15 px-2 py-1.5 text-sm focus:outline-none focus:border-accent disabled:opacity-50"
        >
          {RESIDENCY_REGIONS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </label>
    );
  }

  return null;
}
