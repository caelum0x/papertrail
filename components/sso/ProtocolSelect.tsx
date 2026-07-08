"use client";

import type { SsoProtocol } from "@/lib/sso/types";
import { PROTOCOL_OPTIONS } from "@/components/sso/fields";

// Protocol picker step of the connection wizard: choose SAML or OIDC. Controlled
// by the parent form. Presentational.

interface ProtocolSelectProps {
  value: SsoProtocol;
  onChange: (protocol: SsoProtocol) => void;
}

export function ProtocolSelect({ value, onChange }: ProtocolSelectProps) {
  return (
    <fieldset>
      <legend className="text-xs font-semibold uppercase tracking-wide text-ink/60">
        Protocol
      </legend>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {PROTOCOL_OPTIONS.map((opt) => {
          const active = opt.value === value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange(opt.value)}
              className={`text-left border rounded-lg p-4 transition-colors ${
                active
                  ? "border-accent bg-white"
                  : "border-ink/15 bg-paper hover:border-accent"
              }`}
              aria-pressed={active}
            >
              <div className="text-sm font-medium text-ink/80">{opt.label}</div>
              <p className="mt-1 text-xs text-ink/50">
                {opt.value === "saml"
                  ? "Assertion-based SSO via IdP metadata and an X.509 signing certificate."
                  : "Token-based SSO via an issuer URL and client credentials."}
              </p>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
