import Link from "next/link";

// Call-to-action card that links to the new-connection wizard. Presentational.

export function AddConnectionCard() {
  return (
    <Link
      href="/console/settings/sso/new"
      className="block bg-white border border-dashed border-ink/15 rounded-lg p-5 hover:border-accent transition-colors"
    >
      <h3 className="text-sm font-medium text-ink/80">Add SSO connection</h3>
      <p className="mt-1 text-sm text-ink/60">
        Configure SAML 2.0 or OpenID Connect so your team signs in through your
        identity provider. You&rsquo;ll verify domain ownership before it goes
        live.
      </p>
      <span className="mt-3 inline-block text-xs text-accent">
        Start setup →
      </span>
    </Link>
  );
}
