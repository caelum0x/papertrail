"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { SsoProtocol } from "@/lib/sso/types";
import { createConnection } from "@/components/sso/api";
import { ProtocolSelect } from "@/components/sso/ProtocolSelect";
import { ConfigFieldGroup } from "@/components/sso/ConfigFieldGroup";
import { fieldsForProtocol } from "@/components/sso/fields";

// New-connection wizard. Composes ProtocolSelect + a name/domain field group +
// the protocol-specific ConfigFieldGroup. Client component: submits via the
// module api client and redirects to the created connection's detail page.

export function ConnectionForm() {
  const router = useRouter();
  const [protocol, setProtocol] = useState<SsoProtocol>("saml");
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [config, setConfig] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onConfigChange = useCallback((key: string, value: string) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
  }, []);

  // Switching protocol resets protocol-specific config so stale keys don't leak.
  const onProtocolChange = useCallback((p: SsoProtocol) => {
    setProtocol(p);
    setConfig({});
    setError(null);
  }, []);

  const fields = useMemo(() => fieldsForProtocol(protocol), [protocol]);

  const onSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);

      const trimmedName = name.trim();
      if (!trimmedName) {
        setError("A name is required.");
        return;
      }
      // Client-side required-field check for a friendlier message.
      for (const field of fields) {
        if (field.required && !(config[field.key] ?? "").trim()) {
          setError(`${field.label} is required.`);
          return;
        }
      }

      const cleanConfig: Record<string, string> = {};
      for (const field of fields) {
        const value = (config[field.key] ?? "").trim();
        if (value) cleanConfig[field.key] = value;
      }

      setSaving(true);
      try {
        const created = await createConnection({
          protocol,
          name: trimmedName,
          domain: domain.trim() || undefined,
          config: cleanConfig,
        });
        router.push(`/console/settings/sso/${created.id}`);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to create connection."
        );
        setSaving(false);
      }
    },
    [name, domain, protocol, config, fields, router]
  );

  return (
    <form onSubmit={onSubmit} className="max-w-2xl space-y-8">
      <ProtocolSelect value={protocol} onChange={onProtocolChange} />

      <fieldset>
        <legend className="text-xs font-semibold uppercase tracking-wide text-ink/60">
          Details
        </legend>
        <div className="mt-3 space-y-4">
          <div>
            <label htmlFor="sso-name" className="block text-xs text-ink/60">
              Connection name <span className="text-red-600">*</span>
            </label>
            <input
              id="sso-name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              placeholder="Okta — Gladstone Labs"
              className="mt-1 w-full text-sm border border-ink/15 rounded px-3 py-2 focus:outline-none focus:border-accent"
            />
          </div>
          <div>
            <label htmlFor="sso-domain" className="block text-xs text-ink/60">
              Email domain
            </label>
            <input
              id="sso-domain"
              type="text"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              maxLength={255}
              placeholder="lab.example.edu"
              className="mt-1 w-full text-sm font-mono border border-ink/15 rounded px-3 py-2 focus:outline-none focus:border-accent"
            />
            <p className="mt-1 text-xs text-ink/40">
              You&rsquo;ll verify ownership of this domain before the connection
              can be activated.
            </p>
          </div>
        </div>
      </fieldset>

      <fieldset>
        <legend className="text-xs font-semibold uppercase tracking-wide text-ink/60">
          Provider configuration
        </legend>
        <div className="mt-3">
          <ConfigFieldGroup
            protocol={protocol}
            values={config}
            onChange={onConfigChange}
          />
        </div>
      </fieldset>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={saving}
          className="text-sm bg-accent text-white rounded px-4 py-2 disabled:opacity-50"
        >
          {saving ? "Creating…" : "Create connection"}
        </button>
        <button
          type="button"
          onClick={() => router.push("/console/settings/sso")}
          className="text-sm text-ink/60 hover:text-ink/80"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
